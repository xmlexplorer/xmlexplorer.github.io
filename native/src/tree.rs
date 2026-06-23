use libxml::tree::{Node, NodeType};
use serde::Serialize;

use crate::document::{DocumentStore, OpenDocument};

#[derive(Serialize, Clone)]
pub struct NodeSummary {
    pub node_id: u64,
    pub node_type: &'static str,
    pub label: String,
    pub has_children: bool,
}

/// Real documents can have nodes with millions of direct children (e.g. a flat
/// list of sibling records) -- serializing all of them over IPC in one shot and
/// dumping them into the frontend's state is what actually freezes the UI, even
/// though the libxml2-side traversal itself stays fast. `get_children` returns
/// pages of this size instead; the frontend fetches more as needed.
pub const CHILDREN_PAGE_SIZE: usize = 500;

#[derive(Serialize)]
pub struct NodeSummaryPage {
    pub items: Vec<NodeSummary>,
    pub offset: usize,
    pub total: usize,
    pub has_more: bool,
}

fn page_of(ids: &[u64], offset: usize, open_doc: &OpenDocument) -> Result<NodeSummaryPage, String> {
    let total = ids.len();
    let items: Vec<NodeSummary> = ids
        .iter()
        .skip(offset)
        .take(CHILDREN_PAGE_SIZE)
        .map(|&id| open_doc.get_node(id).map(|n| build_node_summary(id, n)))
        .collect::<Result<_, _>>()?;
    let has_more = offset + items.len() < total;
    Ok(NodeSummaryPage { items, offset, total, has_more })
}

/// Mirrors XPathNavigatorTreeNode.StripNonPrintableChars: trims leading/trailing
/// \r\n\t, drops embedded \r and \t, and collapses embedded \n to a space, so
/// multi-line text/comment content renders on a single tree row.
fn strip_non_printable(value: &str) -> String {
    value
        .trim_matches(|c| c == '\r' || c == '\n' || c == '\t')
        .replace('\r', "")
        .replace('\n', " ")
        .replace('\t', "")
}

/// Pretty-printed XML files put a whitespace-only text node (just the indentation
/// newline/spaces) between every pair of sibling elements. Showing each as its own
/// blank-looking tree row is pure noise -- and on a document with a million sibling
/// elements, it doubles the row count that has to be paginated/rendered for no benefit.
/// Real text content (even if it has leading/trailing whitespace) is never filtered.
fn is_insignificant_whitespace(node: &Node) -> bool {
    node.get_type() == Some(NodeType::TextNode) && node.get_content().trim().is_empty()
}

/// Like `node.get_first_child().is_some()`, but ignoring insignificant whitespace --
/// used so an element whose only child is indentation whitespace doesn't show a
/// misleading expand arrow that leads to an apparently empty expansion. Walks siblings
/// directly rather than allocating a Vec via `get_child_nodes()`.
fn has_visible_children(node: &Node) -> bool {
    let mut child = node.get_first_child();
    while let Some(c) = child {
        if !is_insignificant_whitespace(&c) {
            return true;
        }
        child = c.get_next_sibling();
    }
    false
}

fn node_type_name(node: &Node) -> &'static str {
    match node.get_type() {
        Some(NodeType::ElementNode) => "element",
        Some(NodeType::AttributeNode) => "attribute",
        Some(NodeType::TextNode) => "text",
        Some(NodeType::CDataSectionNode) => "cdata",
        Some(NodeType::CommentNode) => "comment",
        Some(NodeType::PiNode) => "pi",
        Some(NodeType::DocumentNode) => "document",
        _ => "other",
    }
}

/// Mirrors XPathNavigatorTreeNode.GetDisplayText. Note: attributes are
/// rendered sorted by name rather than in document order -- libxml2 exposes
/// attribute order via an internal linked-list traversal that this crate
/// doesn't expose publicly, and alphabetical is a reasonable, deterministic
/// stand-in. Revisit if real document order turns out to matter in practice.
fn build_label(node: &Node) -> String {
    match node.get_type() {
        Some(NodeType::CommentNode) => {
            format!("<!--{} -->", strip_non_printable(&node.get_content()))
        }
        Some(NodeType::ElementNode) => {
            let mut label = format!("<{}", node.get_name());

            let mut attributes: Vec<(String, String)> = node.get_properties().into_iter().collect();
            attributes.sort_by(|a, b| a.0.cmp(&b.0));
            for (name, value) in attributes {
                label.push_str(&format!(" {name}=\"{value}\""));
            }

            if has_visible_children(node) {
                label.push('>');
            } else {
                label.push_str("/>");
            }

            label
        }
        _ => strip_non_printable(&node.get_content()),
    }
}

pub fn build_node_summary(node_id: u64, node: &Node) -> NodeSummary {
    NodeSummary {
        node_id,
        node_type: node_type_name(node),
        label: build_label(node),
        has_children: has_visible_children(node),
    }
}

/// Lazily loads and caches the direct children of `node_id`, mirroring the
/// original's "expand on demand" tree loading: the first call assigns fresh
/// arena ids for every child and memoizes the full id list; subsequent calls
/// (including later pages) just re-read that cache. Only the requested page's
/// `NodeSummary`s (with their label strings, attribute formatting, etc.) are
/// actually built -- the rest stay as cheap `Node` handles in the arena until
/// a page that includes them is requested.
pub fn get_children(
    store: &DocumentStore,
    doc_id: u64,
    node_id: u64,
    offset: usize,
) -> Result<NodeSummaryPage, String> {
    store.with_document_mut(doc_id, |open_doc| {
        let child_ids = if let Some(ids) = open_doc.expanded.get(&node_id) {
            ids.clone()
        } else {
            let children = open_doc.get_node(node_id)?.get_child_nodes();
            let ids: Vec<u64> = children
                .into_iter()
                .filter(|child| !is_insignificant_whitespace(child))
                .map(|child| open_doc.push_node(child))
                .collect();
            open_doc.expanded.insert(node_id, ids.clone());
            ids
        };

        page_of(&child_ids, offset, open_doc)
    })
}

#[tauri::command]
pub fn get_children_cmd(
    store: tauri::State<'_, DocumentStore>,
    doc_id: u64,
    node_id: u64,
    offset: usize,
) -> Result<NodeSummaryPage, String> {
    get_children(store.inner(), doc_id, node_id, offset)
}
