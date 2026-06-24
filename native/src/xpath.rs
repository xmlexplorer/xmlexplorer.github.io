use libxml::bindings::{
    xmlXPathObjectType_XPATH_BOOLEAN, xmlXPathObjectType_XPATH_NODESET,
    xmlXPathObjectType_XPATH_NUMBER, xmlXPathObjectType_XPATH_STRING,
};
use libxml::tree::NodeType;
use libxml::xpath::Context;
use serde::Serialize;
use std::collections::HashSet;

use crate::document::{DocumentStore, OpenDocument, XPathCache};
use crate::tree::{build_node_summary, NodeSummaryPage, CHILDREN_PAGE_SIZE};

#[derive(Serialize, Clone)]
pub struct NamespaceDefinition {
    pub prefix: String,
    pub uri: String,
}

/// Walks every element in the document collecting namespace declarations,
/// synthesizing prefixes ("default", "default2", ...) for unprefixed default
/// namespaces so they can still be referenced in XPath 1.0 expressions
/// (which require every namespace to have a prefix). Mirrors
/// XPathNavigatorTreeView.LoadNamespaceDefinitions.
///
/// Memoized on `OpenDocument` -- walking every element is too expensive to
/// redo on every `evaluate_xpath` call on a large document.
fn discover_namespaces(open_doc: &mut OpenDocument) -> Result<Vec<NamespaceDefinition>, String> {
    if let Some(cached) = &open_doc.namespaces_cache {
        return Ok(cached
            .iter()
            .map(|(prefix, uri)| NamespaceDefinition {
                prefix: prefix.clone(),
                uri: uri.clone(),
            })
            .collect());
    }

    let root = open_doc.get_node(0)?.clone();

    let mut raw = Vec::new();
    let mut raw_seen = HashSet::new();
    // Walk via get_first_child/get_next_sibling directly rather than
    // get_child_nodes(), which heap-allocates a fresh Vec per node -- on a
    // multi-million-node document that allocation overhead alone is the
    // difference between this being a one-time blip and a multi-second stall.
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        if node.get_type() == Some(NodeType::ElementNode) {
            for ns in node.get_namespace_declarations() {
                let key = (ns.get_prefix(), ns.get_href());
                if raw_seen.insert(key.clone()) {
                    raw.push(key);
                }
            }
        }
        let mut child = node.get_first_child();
        while let Some(c) = child {
            let next = c.get_next_sibling();
            stack.push(c);
            child = next;
        }
    }

    let mut default_count = 0;
    let definitions: Vec<NamespaceDefinition> = raw
        .into_iter()
        .map(|(prefix, uri)| {
            let prefix = if prefix.is_empty() {
                default_count += 1;
                if default_count == 1 {
                    "default".to_string()
                } else {
                    format!("default{default_count}")
                }
            } else {
                prefix
            };
            NamespaceDefinition { prefix, uri }
        })
        .collect();

    open_doc.namespaces_cache = Some(
        definitions
            .iter()
            .map(|d| (d.prefix.clone(), d.uri.clone()))
            .collect(),
    );

    Ok(definitions)
}

pub fn list_namespaces(store: &DocumentStore, doc_id: u64) -> Result<Vec<NamespaceDefinition>, String> {
    store.with_document_mut(doc_id, discover_namespaces)
}

/// The result of an XPath evaluation. A node-set (e.g. `//book`) comes back as a
/// page of matching nodes -- paginated exactly like `get_children`, because a
/// query like `//item` on a multi-million-node document would otherwise serialize
/// the entire match set over IPC and freeze the UI. A non-node-set result (e.g.
/// `count(//book)`, `string(//title)`, `//book/@id = '1'`) comes back as a scalar
/// value, mirroring the original's "show count()/string() results in a window".
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum XPathResult {
    NodeSet { page: NodeSummaryPage },
    Scalar { value_type: &'static str, value: String },
}

/// Builds one page of the cached XPath node-set, assigning arena ids on demand for
/// just the matches in this page. The cache is taken out of `open_doc` for the
/// duration so we can both read the matched nodes and push new arena entries
/// without overlapping borrows, then put back.
fn xpath_page(open_doc: &mut OpenDocument, offset: usize) -> Result<NodeSummaryPage, String> {
    let mut cache = open_doc
        .xpath_cache
        .take()
        .ok_or_else(|| "no cached xpath result".to_string())?;

    let total = cache.nodes.len();
    let end = (offset + CHILDREN_PAGE_SIZE).min(total);

    let mut items = Vec::new();
    for i in offset..end {
        let id = match cache.ids[i] {
            Some(id) => id,
            None => {
                let id = open_doc.push_node(cache.nodes[i].clone());
                cache.ids[i] = Some(id);
                id
            }
        };
        let node = open_doc.get_node(id)?;
        items.push(build_node_summary(id, node));
    }

    let page = NodeSummaryPage {
        items,
        offset,
        total,
        has_more: end < total,
    };
    open_doc.xpath_cache = Some(cache);
    Ok(page)
}

/// Evaluates `expression` with `node_id` as the context node, with every
/// namespace declared anywhere in the document registered under its
/// (possibly synthesized) prefix -- mirrors `XPathNavigator.Evaluate(xpath,
/// namespaceManager)`. Node-set matches get fresh arena ids (same as
/// `get_children`) and are returned a page at a time; `offset` selects the page.
/// Re-querying the same expression/context just pages the cached result.
pub fn evaluate_xpath(
    store: &DocumentStore,
    doc_id: u64,
    node_id: u64,
    expression: &str,
    offset: usize,
) -> Result<XPathResult, String> {
    store.with_document_mut(doc_id, |open_doc| {
        // Serve a later page of an already-evaluated query from cache rather than
        // re-running it.
        if let Some(cache) = &open_doc.xpath_cache {
            if cache.node_id == node_id && cache.expression == expression {
                return Ok(XPathResult::NodeSet {
                    page: xpath_page(open_doc, offset)?,
                });
            }
        }

        let namespaces = discover_namespaces(open_doc)?;
        let context_node = open_doc.get_node(node_id)?.clone();

        let mut context = Context::new(&open_doc.doc)
            .map_err(|_| "failed to create xpath context".to_string())?;
        context
            .set_context_node(&context_node)
            .map_err(|_| "failed to set xpath context node".to_string())?;
        for ns in &namespaces {
            context
                .register_namespace(&ns.prefix, &ns.uri)
                .map_err(|_| format!("invalid namespace prefix '{}'", ns.prefix))?;
        }

        let object = context
            .evaluate(expression)
            .map_err(|_| format!("invalid xpath expression: {expression}"))?;

        // SAFETY: `object.ptr` is the live xmlXPathObjectPtr just returned by a
        // successful evaluate(); reading its `type_` discriminant is a plain field
        // read on a valid, non-null pointer that outlives this access.
        let object_type = unsafe { (*object.ptr).type_ };

        if object_type == xmlXPathObjectType_XPATH_NODESET {
            // Hold the matched nodes; arena ids are assigned lazily, per page,
            // by xpath_page -- see XPathCache.
            let nodes = object.get_nodes_as_vec();
            let id_slots = vec![None; nodes.len()];
            open_doc.xpath_cache = Some(XPathCache {
                node_id,
                expression: expression.to_string(),
                nodes,
                ids: id_slots,
            });
            Ok(XPathResult::NodeSet {
                page: xpath_page(open_doc, offset)?,
            })
        } else {
            // Scalar result -- no node-set to page, so drop any stale cache.
            open_doc.xpath_cache = None;
            let value_type = match object_type {
                t if t == xmlXPathObjectType_XPATH_BOOLEAN => "boolean",
                t if t == xmlXPathObjectType_XPATH_NUMBER => "number",
                t if t == xmlXPathObjectType_XPATH_STRING => "string",
                _ => "string",
            };
            Ok(XPathResult::Scalar {
                value_type,
                value: object.to_string(),
            })
        }
    })
}

// async so Tauri runs it on its worker pool rather than the main (UI) thread:
// evaluating e.g. //item against a multi-million-node document is seconds of
// CPU-bound work, and a sync command would block the webview and beachball the
// app. There's no .await spanning the libxml work (it all happens inside the
// synchronous helper), so the !Send node handles never cross an await point.
#[tauri::command]
pub async fn list_namespaces_cmd(
    store: tauri::State<'_, DocumentStore>,
    doc_id: u64,
) -> Result<Vec<NamespaceDefinition>, String> {
    list_namespaces(store.inner(), doc_id)
}

#[tauri::command]
pub async fn evaluate_xpath_cmd(
    store: tauri::State<'_, DocumentStore>,
    doc_id: u64,
    node_id: u64,
    expression: String,
    offset: usize,
) -> Result<XPathResult, String> {
    evaluate_xpath(store.inner(), doc_id, node_id, &expression, offset)
}
