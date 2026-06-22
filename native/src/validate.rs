use libxml::error::{StructuredError, XmlErrorLevel};
use libxml::schemas::{SchemaParserContext, SchemaValidationContext};
use libxml::xpath::Context;
use serde::Serialize;
use std::path::Path;

use crate::document::{DocumentStore, OpenDocument};

#[derive(Serialize, Debug)]
pub struct ValidationIssue {
    pub severity: &'static str,
    pub line: Option<i32>,
    pub col: Option<i32>,
    pub message: String,
}

const XSI_NS: &str = "http://www.w3.org/2001/XMLSchema-instance";

fn resolve_schema_path(open_doc: &OpenDocument, schema_path: &str) -> String {
    if Path::new(schema_path).is_file() {
        return schema_path.to_string();
    }
    if let Some(dir) = Path::new(&open_doc.path).parent() {
        let candidate = dir.join(schema_path);
        if candidate.is_file() {
            return candidate.to_string_lossy().into_owned();
        }
    }
    schema_path.to_string()
}

/// Finds the first usable schema reference declared in the document via
/// `xsi:schemaLocation`/`xsi:noNamespaceSchemaLocation`, resolved relative to
/// the document's own directory if not found as-is. Mirrors
/// XPathNavigatorTreeView.Validate's schema auto-discovery, simplified to a
/// single schema source: unlike .NET's XmlSchemaSet, libxml2's schema
/// validation context validates against one schema document at a time (that
/// document is expected to <xs:import>/<xs:include> any others it needs), so
/// multi-namespace xsi:schemaLocation lists use only the first pair.
fn find_schema_location(open_doc: &mut OpenDocument) -> Result<Option<String>, String> {
    let context = Context::new(&open_doc.doc)
        .map_err(|_| "failed to create xpath context".to_string())?;

    let no_ns_query =
        format!("//@*[local-name()='noNamespaceSchemaLocation' and namespace-uri()='{XSI_NS}']");
    if let Ok(result) = context.evaluate(&no_ns_query) {
        if let Some(value) = result.get_nodes_as_vec().first().map(|n| n.get_content()) {
            return Ok(Some(resolve_schema_path(open_doc, value.trim())));
        }
    }

    let schema_location_query =
        format!("//@*[local-name()='schemaLocation' and namespace-uri()='{XSI_NS}']");
    if let Ok(result) = context.evaluate(&schema_location_query) {
        if let Some(value) = result.get_nodes_as_vec().first().map(|n| n.get_content()) {
            // value is "namespace1 path1 namespace2 path2 ..."; we only use the first pair.
            if let Some(path) = value.split_whitespace().nth(1) {
                return Ok(Some(resolve_schema_path(open_doc, path)));
            }
        }
    }

    Ok(None)
}

fn structured_error_to_issue(error: StructuredError) -> ValidationIssue {
    ValidationIssue {
        severity: match error.level {
            XmlErrorLevel::Warning => "warning",
            _ => "error",
        },
        line: error.line.map(|v| v as i32),
        col: error.col.map(|v| v as i32),
        message: error
            .message
            .unwrap_or_else(|| "unknown validation error".to_string()),
    }
}

pub fn validate_document(store: &DocumentStore, doc_id: u64) -> Result<Vec<ValidationIssue>, String> {
    store.with_document_mut(doc_id, |open_doc| {
        let schema_path = find_schema_location(open_doc)?;

        let Some(schema_path) = schema_path else {
            return Ok(vec![ValidationIssue {
                severity: "warning",
                line: None,
                col: None,
                message: "Document does not specify a schema (xsi:schemaLocation or \
                          xsi:noNamespaceSchemaLocation) to validate against."
                    .to_string(),
            }]);
        };

        if !Path::new(&schema_path).is_file() {
            return Ok(vec![ValidationIssue {
                severity: "error",
                line: None,
                col: None,
                message: format!("Cannot find the schema document at '{schema_path}'"),
            }]);
        }

        let mut parser = SchemaParserContext::from_file(&schema_path);
        let schema = SchemaValidationContext::from_parser(&mut parser);

        let mut schema = match schema {
            Ok(schema) => schema,
            Err(errors) => return Ok(errors.into_iter().map(structured_error_to_issue).collect()),
        };

        match schema.validate_document(&open_doc.doc) {
            Ok(()) => Ok(Vec::new()),
            Err(errors) => Ok(errors.into_iter().map(structured_error_to_issue).collect()),
        }
    })
}

#[tauri::command]
pub fn validate_document_cmd(
    store: tauri::State<'_, DocumentStore>,
    doc_id: u64,
) -> Result<Vec<ValidationIssue>, String> {
    validate_document(store.inner(), doc_id)
}
