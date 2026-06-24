mod document;
mod format;
#[cfg(test)]
mod integration_tests;
mod spike;
mod tree;
mod validate;
mod xpath;

use document::DocumentStore;
use tauri::Manager;

const AD_FRAME_URL: &str = "https://xmlexplorer.github.io/ad-frame.html";
const AD_LABEL: &str = "ad";
const AD_HEIGHT: f64 = 90.0;

// The ad must live in its own native webview rather than an HTML <iframe> in the main
// page: AdSense's rendering script reads `window.top`, which throws (and aborts ad
// rendering) when the parent document's origin uses Tauri's non-http(s) `tauri://`
// scheme. A child webview is a separate top-level browsing context -- no parent frame
// relationship at all -- so it behaves like a real browser tab instead.
#[cfg(desktop)]
fn position_ad_webview<R: tauri::Runtime>(window: &tauri::Window<R>) {
    let Ok(physical_size) = window.inner_size() else { return };
    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let logical_size = physical_size.to_logical::<f64>(scale_factor);
    let Some(ad) = window.webviews().into_iter().find(|w| w.label() == AD_LABEL) else { return };
    let _ = ad.set_position(tauri::LogicalPosition::new(0.0, (logical_size.height - AD_HEIGHT).max(0.0)));
    let _ = ad.set_size(tauri::LogicalSize::new(logical_size.width, AD_HEIGHT));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
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
        .setup(|app| {
            #[cfg(desktop)]
            {
                let window = app.get_window("main").expect("main window must exist");
                let ad_url = tauri::WebviewUrl::External(
                    AD_FRAME_URL.parse().expect("AD_FRAME_URL must be a valid URL"),
                );
                window.add_child(
                    tauri::webview::WebviewBuilder::new(AD_LABEL, ad_url),
                    tauri::LogicalPosition::new(0.0, 0.0),
                    tauri::LogicalSize::new(1.0, 1.0),
                )?;
                position_ad_webview(&window);
                let resize_window = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Resized(_) = event {
                        position_ad_webview(&resize_window);
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
