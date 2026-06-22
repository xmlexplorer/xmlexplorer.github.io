use libxml::tree::{Node, NodeType};
use serde::Serialize;

use crate::document::DocumentStore;

#[derive(Serialize, Clone)]
pub struct NodeSummary {
    pub node_id: u64,
    pub node_type: &'static str,
    pub label: String,
    pub has_children: bool,
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

            if node.get_first_child().is_some() {
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
        has_children: node.get_first_child().is_some(),
    }
}

/// Lazily loads and caches the direct children of `node_id`, mirroring the
/// original's "expand on demand" tree loading: the first call assigns fresh
/// arena ids and memoizes them; subsequent calls just re-read the cache.
pub fn get_children(
    store: &DocumentStore,
    doc_id: u64,
    node_id: u64,
) -> Result<Vec<NodeSummary>, String> {
    store.with_document_mut(doc_id, |open_doc| {
        if let Some(child_ids) = open_doc.expanded.get(&node_id) {
            return child_ids
                .iter()
                .map(|&id| open_doc.get_node(id).map(|n| build_node_summary(id, n)))
                .collect();
        }

        let children = open_doc.get_node(node_id)?.get_child_nodes();

        let mut summaries = Vec::with_capacity(children.len());
        let mut child_ids = Vec::with_capacity(children.len());
        for child in children {
            let id = open_doc.push_node(child);
            summaries.push(build_node_summary(id, open_doc.get_node(id)?));
            child_ids.push(id);
        }

        open_doc.expanded.insert(node_id, child_ids);

        Ok(summaries)
    })
}

#[tauri::command]
pub fn get_children_cmd(
    store: tauri::State<'_, DocumentStore>,
    doc_id: u64,
    node_id: u64,
) -> Result<Vec<NodeSummary>, String> {
    get_children(store.inner(), doc_id, node_id)
}
