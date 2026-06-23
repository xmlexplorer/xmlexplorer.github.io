mod document;
mod format;
#[cfg(test)]
mod integration_tests;
mod spike;
mod tree;
mod validate;
mod xpath;

use document::DocumentStore;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(DocumentStore::default())
        .invoke_handler(tauri::generate_handler![
            spike::spike_open_and_query,
            document::open_document_cmd,
            document::close_document_cmd,
            tree::get_children_cmd,
            tree::get_node_path_cmd,
            xpath::list_namespaces_cmd,
            xpath::evaluate_xpath_cmd,
            validate::validate_document_cmd,
            format::get_formatted_outer_xml_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
