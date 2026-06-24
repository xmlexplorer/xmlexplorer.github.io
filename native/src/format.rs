use libxml::bindings::{xmlBufferContent, xmlBufferCreate, xmlBufferFree, xmlNodeDump};
use std::ffi::CStr;
use std::os::raw::c_char;

use crate::document::DocumentStore;

/// Serializes `node_id`'s subtree as indented XML, mirroring
/// XPathNavigatorTreeView.GetXPathNavigatorFormattedOuterXml (an XmlWriter
/// with Indent=true writing the subtree). The `libxml` crate's own
/// `Document::node_to_string` hardcodes formatting off, so this calls
/// libxml2's `xmlNodeDump` directly with the format flag enabled.
pub fn get_formatted_outer_xml(
    store: &DocumentStore,
    doc_id: u64,
    node_id: u64,
) -> Result<String, String> {
    store.with_document_mut(doc_id, |open_doc| {
        let doc_ptr = open_doc.doc.doc_ptr();
        let node_ptr = open_doc.get_node(node_id)?.node_ptr();

        let text = unsafe {
            let buffer = xmlBufferCreate();
            if buffer.is_null() {
                return Err("failed to allocate libxml2 buffer".to_string());
            }

            xmlNodeDump(buffer, doc_ptr, node_ptr, 0, 1); // level=0, format=1 (indented)

            let content_ptr = xmlBufferContent(buffer);
            let text = if content_ptr.is_null() {
                String::new()
            } else {
                CStr::from_ptr(content_ptr as *const c_char)
                    .to_string_lossy()
                    .into_owned()
            };

            xmlBufferFree(buffer);
            text
        };

        Ok(text)
    })
}

// async so serializing a large subtree runs off the main (UI) thread -- see the
// note on evaluate_xpath_cmd.
#[tauri::command]
pub async fn get_formatted_outer_xml_cmd(
    store: tauri::State<'_, DocumentStore>,
    doc_id: u64,
    node_id: u64,
) -> Result<String, String> {
    get_formatted_outer_xml(store.inner(), doc_id, node_id)
}
