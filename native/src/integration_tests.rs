use crate::document::DocumentStore;
use std::time::Instant;
use crate::format::get_formatted_outer_xml;
use crate::tree::get_children;
use crate::validate::validate_document;
use crate::xpath::{evaluate_xpath, list_namespaces};

fn fixture(name: &str) -> String {
    format!("{}/fixtures/{}", env!("CARGO_MANIFEST_DIR"), name)
}

#[test]
fn open_reports_root_label_and_children() {
    let store = DocumentStore::default();
    let opened = store.open(&fixture("catalog.xml")).expect("open catalog.xml");

    assert_eq!(opened.root.node_type, "element");
    assert_eq!(opened.root.label, "<catalog>");
    assert!(opened.root.has_children);
}

#[test]
fn get_children_is_lazy_and_idempotent() {
    let store = DocumentStore::default();
    let opened = store.open(&fixture("catalog.xml")).expect("open catalog.xml");

    let first_call = get_children(&store, opened.doc_id, opened.root.node_id).expect("get_children");
    // whitespace text nodes between elements + the comment + two <book> elements
    // note the double space before "-->": the source comment text itself already has a
    // trailing space (`<!-- inventory listing -->`), and build_label always appends its own
    // " -->" unconditionally -- this matches XPathNavigatorTreeNode.GetDisplayText exactly,
    // artifact and all.
    assert!(first_call.iter().any(|n| n.node_type == "comment" && n.label == "<!-- inventory listing  -->"));
    let books: Vec<_> = first_call.iter().filter(|n| n.node_type == "element" && n.label.starts_with("<book")).collect();
    assert_eq!(books.len(), 2);
    assert_eq!(books[0].label, "<book id=\"bk101\">");

    // second call should return the same (memoized) ids, not duplicate arena entries
    let second_call = get_children(&store, opened.doc_id, opened.root.node_id).expect("get_children again");
    assert_eq!(
        first_call.iter().map(|n| n.node_id).collect::<Vec<_>>(),
        second_call.iter().map(|n| n.node_id).collect::<Vec<_>>()
    );
}

#[test]
fn self_closing_element_has_no_children() {
    let store = DocumentStore::default();
    let opened = store.open(&fixture("catalog.xml")).expect("open catalog.xml");

    let top = get_children(&store, opened.doc_id, opened.root.node_id).unwrap();
    let first_book = top.iter().find(|n| n.label == "<book id=\"bk101\">").unwrap();

    let book_children = get_children(&store, opened.doc_id, first_book.node_id).unwrap();
    let cover = book_children.iter().find(|n| n.label.starts_with("<cover")).unwrap();
    assert_eq!(cover.label, "<cover/>");
    assert!(!cover.has_children);
}

#[test]
fn evaluate_xpath_finds_matching_elements() {
    let store = DocumentStore::default();
    let opened = store.open(&fixture("catalog.xml")).expect("open catalog.xml");

    let results = evaluate_xpath(&store, opened.doc_id, opened.root.node_id, "//book[@id='bk102']/title")
        .expect("evaluate_xpath");

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].node_type, "element");
    assert_eq!(results[0].label, "<title>");
}

#[test]
fn namespaces_are_discovered_and_queryable() {
    let store = DocumentStore::default();
    let opened = store.open(&fixture("namespaced.xml")).expect("open namespaced.xml");

    let namespaces = list_namespaces(&store, opened.doc_id).expect("list_namespaces");
    assert!(namespaces.iter().any(|n| n.prefix == "default" && n.uri == "http://example.com/store"));
    assert!(namespaces.iter().any(|n| n.prefix == "inv" && n.uri == "http://example.com/inventory"));

    // the document's own "inv" prefix is usable directly
    let books = evaluate_xpath(&store, opened.doc_id, opened.root.node_id, "//inv:book").expect("xpath inv:book");
    assert_eq!(books.len(), 1);

    // the synthesized "default" prefix makes the unprefixed default-namespace elements queryable
    let titles = evaluate_xpath(&store, opened.doc_id, opened.root.node_id, "//default:title").expect("xpath default:title");
    assert_eq!(titles.len(), 1);
}

#[test]
fn validate_reports_warning_when_no_schema_declared() {
    let store = DocumentStore::default();
    let opened = store.open(&fixture("catalog.xml")).expect("open catalog.xml");

    let issues = validate_document(&store, opened.doc_id).expect("validate_document");
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].severity, "warning");
}

#[test]
fn validate_passes_for_schema_conformant_document() {
    let store = DocumentStore::default();
    let opened = store.open(&fixture("catalog-with-schema.xml")).expect("open catalog-with-schema.xml");

    let issues = validate_document(&store, opened.doc_id).expect("validate_document");
    assert!(issues.is_empty(), "expected no validation issues, got {issues:?}");
}

#[test]
fn validate_reports_errors_for_schema_violations() {
    let store = DocumentStore::default();
    let opened = store.open(&fixture("catalog-invalid.xml")).expect("open catalog-invalid.xml");

    let issues = validate_document(&store, opened.doc_id).expect("validate_document");
    assert!(!issues.is_empty());
    assert!(issues.iter().all(|i| i.severity == "error"));
}

#[test]
fn formatted_outer_xml_is_indented() {
    let store = DocumentStore::default();
    let opened = store.open(&fixture("catalog.xml")).expect("open catalog.xml");

    let top = get_children(&store, opened.doc_id, opened.root.node_id).unwrap();
    let first_book = top.iter().find(|n| n.label == "<book id=\"bk101\">").unwrap();

    let xml = get_formatted_outer_xml(&store, opened.doc_id, first_book.node_id).expect("get_formatted_outer_xml");
    assert!(xml.contains("<book id=\"bk101\">"));
    let title_line = xml.lines().find(|l| l.contains("<title>")).expect("title line");
    assert!(
        title_line.starts_with(' '),
        "expected an indented title line, got: {title_line:?}"
    );
    assert!(xml.contains("XML Developer's Guide"));
}

/// Exercises the real document/tree engine (not the standalone Phase 1 spike) against the
/// same 200MB/1.18M-node fixture used to validate cross-platform libxml2 performance, since
/// that's the plan's actual Phase 2 exit criterion: "tests passing against all fixtures
/// including the large-file one."
#[test]
#[ignore = "requires SPIKE_FIXTURE=/path/to/large.xml; not part of the default fixture-driven suite"]
fn large_fixture_open_and_expand_is_fast() {
    let path = std::env::var("SPIKE_FIXTURE")
        .expect("set SPIKE_FIXTURE=/path/to/large.xml to run this test");

    let store = DocumentStore::default();

    let start = Instant::now();
    let opened = store.open(&path).expect("open large fixture");
    println!("open: {:?}", start.elapsed());
    assert_eq!(opened.root.label, "<catalog>");

    let start = Instant::now();
    let children = get_children(&store, opened.doc_id, opened.root.node_id).expect("get_children on root");
    println!("get_children(root) -> {} children (incl. whitespace text nodes) in {:?}", children.len(), start.elapsed());
    let item_children: Vec<_> = children.iter().filter(|n| n.node_type == "element").collect();
    assert_eq!(item_children.len(), 1_178_422);

    let first_item = item_children.first().expect("at least one item");
    let start = Instant::now();
    let results = evaluate_xpath(&store, opened.doc_id, opened.root.node_id, "//item")
        .expect("evaluate_xpath //item");
    println!("evaluate_xpath(//item) -> {} matches in {:?}", results.len(), start.elapsed());
    assert_eq!(results.len(), 1_178_422);

    let xml = get_formatted_outer_xml(&store, opened.doc_id, first_item.node_id)
        .expect("get_formatted_outer_xml on first item");
    assert!(xml.contains("Widget 0"));
}
