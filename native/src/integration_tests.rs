use crate::document::DocumentStore;
use std::time::Instant;
use crate::format::get_formatted_outer_xml;
use crate::tree::{get_children, get_node_path};
use crate::validate::validate_document;
use crate::xpath::{evaluate_xpath, list_namespaces, XPathResult};

fn fixture(name: &str) -> String {
    format!("{}/fixtures/{}", env!("CARGO_MANIFEST_DIR"), name)
}

/// Unwraps an XPath result expected to be a node-set, failing loudly if it came
/// back as a scalar instead.
fn nodeset(result: XPathResult) -> crate::tree::NodeSummaryPage {
    match result {
        XPathResult::NodeSet { page } => page,
        XPathResult::Scalar { value_type, value } => {
            panic!("expected a node-set, got {value_type} scalar: {value}")
        }
    }
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

    let first_call = get_children(&store, opened.doc_id, opened.root.node_id, 0).expect("get_children");
    // whitespace text nodes between elements + the comment + two <book> elements
    // note the double space before "-->": the source comment text itself already has a
    // trailing space (`<!-- inventory listing -->`), and build_label always appends its own
    // " -->" unconditionally -- this matches XPathNavigatorTreeNode.GetDisplayText exactly,
    // artifact and all.
    assert!(first_call.items.iter().any(|n| n.node_type == "comment" && n.label == "<!-- inventory listing  -->"));
    let books: Vec<_> = first_call.items.iter().filter(|n| n.node_type == "element" && n.label.starts_with("<book")).collect();
    assert_eq!(books.len(), 2);
    assert_eq!(books[0].label, "<book id=\"bk101\">");
    assert!(!first_call.has_more, "catalog.xml's small child list should fit in a single page");

    // second call should return the same (memoized) ids, not duplicate arena entries
    let second_call = get_children(&store, opened.doc_id, opened.root.node_id, 0).expect("get_children again");
    assert_eq!(
        first_call.items.iter().map(|n| n.node_id).collect::<Vec<_>>(),
        second_call.items.iter().map(|n| n.node_id).collect::<Vec<_>>()
    );
}

#[test]
fn self_closing_element_has_no_children() {
    let store = DocumentStore::default();
    let opened = store.open(&fixture("catalog.xml")).expect("open catalog.xml");

    let top = get_children(&store, opened.doc_id, opened.root.node_id, 0).unwrap();
    let first_book = top.items.iter().find(|n| n.label == "<book id=\"bk101\">").unwrap();

    let book_children = get_children(&store, opened.doc_id, first_book.node_id, 0).unwrap();
    let cover = book_children.items.iter().find(|n| n.label.starts_with("<cover")).unwrap();
    assert_eq!(cover.label, "<cover/>");
    assert!(!cover.has_children);
}

#[test]
fn node_path_locates_a_nested_node() {
    let store = DocumentStore::default();
    let opened = store.open(&fixture("catalog.xml")).expect("open catalog.xml");

    // The root resolves to an empty path (it's the base the path is relative to).
    assert_eq!(
        get_node_path(&store, opened.doc_id, opened.root.node_id).expect("path of root"),
        Vec::<usize>::new()
    );

    let top = get_children(&store, opened.doc_id, opened.root.node_id, 0).unwrap();
    let book_index = top
        .items
        .iter()
        .position(|n| n.label == "<book id=\"bk101\">")
        .expect("bk101 present");
    let book = &top.items[book_index];
    assert_eq!(
        get_node_path(&store, opened.doc_id, book.node_id).expect("path of book"),
        vec![book_index]
    );

    let book_children = get_children(&store, opened.doc_id, book.node_id, 0).unwrap();
    let title_index = book_children
        .items
        .iter()
        .position(|n| n.label == "<title>")
        .expect("title present");
    let title = &book_children.items[title_index];
    assert_eq!(
        get_node_path(&store, opened.doc_id, title.node_id).expect("path of title"),
        vec![book_index, title_index]
    );
}

#[test]
fn node_summary_includes_text_value_for_leaf_elements_only() {
    let store = DocumentStore::default();
    let opened = store.open(&fixture("catalog.xml")).expect("open catalog.xml");

    let top = get_children(&store, opened.doc_id, opened.root.node_id, 0).unwrap();
    let book = top.items.iter().find(|n| n.label.starts_with("<book")).unwrap();
    // An element with child elements has no text preview.
    assert_eq!(book.value, None);

    let book_children = get_children(&store, opened.doc_id, book.node_id, 0).unwrap();
    let title = book_children.items.iter().find(|n| n.label == "<title>").unwrap();
    // A plain-text leaf element previews its content.
    assert_eq!(title.value.as_deref(), Some("XML Developer's Guide"));
}

#[test]
fn evaluate_xpath_finds_matching_elements() {
    let store = DocumentStore::default();
    let opened = store.open(&fixture("catalog.xml")).expect("open catalog.xml");

    let page = nodeset(
        evaluate_xpath(&store, opened.doc_id, opened.root.node_id, "//book[@id='bk102']/title", 0)
            .expect("evaluate_xpath"),
    );

    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].node_type, "element");
    assert_eq!(page.items[0].label, "<title>");
}

#[test]
fn evaluate_xpath_returns_scalar_for_count() {
    let store = DocumentStore::default();
    let opened = store.open(&fixture("catalog.xml")).expect("open catalog.xml");

    let result = evaluate_xpath(&store, opened.doc_id, opened.root.node_id, "count(//book)", 0)
        .expect("evaluate_xpath count");

    match result {
        XPathResult::Scalar { value_type, value } => {
            assert_eq!(value_type, "number");
            assert_eq!(value, "2");
        }
        XPathResult::NodeSet { .. } => panic!("count() should be a scalar, not a node-set"),
    }
}

#[test]
fn evaluate_xpath_pages_a_large_node_set_from_cache() {
    let store = DocumentStore::default();
    let opened = store.open(&fixture("catalog.xml")).expect("open catalog.xml");

    // catalog.xml is small, but exercise the paging path + cache reuse: the second
    // call (different offset, same expression/context) must serve from the cached
    // node-id list, returning a consistent total.
    let first = nodeset(
        evaluate_xpath(&store, opened.doc_id, opened.root.node_id, "//title", 0).expect("page 0"),
    );
    let second = nodeset(
        evaluate_xpath(&store, opened.doc_id, opened.root.node_id, "//title", 1).expect("page 1"),
    );
    assert_eq!(first.total, second.total);
    assert_eq!(first.offset, 0);
    assert_eq!(second.offset, 1);
}

#[test]
fn namespaces_are_discovered_and_queryable() {
    let store = DocumentStore::default();
    let opened = store.open(&fixture("namespaced.xml")).expect("open namespaced.xml");

    let namespaces = list_namespaces(&store, opened.doc_id).expect("list_namespaces");
    assert!(namespaces.iter().any(|n| n.prefix == "default" && n.uri == "http://example.com/store"));
    assert!(namespaces.iter().any(|n| n.prefix == "inv" && n.uri == "http://example.com/inventory"));

    // the document's own "inv" prefix is usable directly
    let books = nodeset(
        evaluate_xpath(&store, opened.doc_id, opened.root.node_id, "//inv:book", 0)
            .expect("xpath inv:book"),
    );
    assert_eq!(books.total, 1);

    // the synthesized "default" prefix makes the unprefixed default-namespace elements queryable
    let titles = nodeset(
        evaluate_xpath(&store, opened.doc_id, opened.root.node_id, "//default:title", 0)
            .expect("xpath default:title"),
    );
    assert_eq!(titles.total, 1);
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

    let top = get_children(&store, opened.doc_id, opened.root.node_id, 0).unwrap();
    let first_book = top.items.iter().find(|n| n.label == "<book id=\"bk101\">").unwrap();

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

    // The root has 1.18M <item> children once insignificant whitespace text nodes
    // (the indentation between pretty-printed siblings) are filtered out -- get_children
    // must return only one bounded page of these, not all of them, or serializing the
    // full set over IPC is exactly what froze the real app's UI when this fixture's
    // root was expanded.
    let start = Instant::now();
    let page = get_children(&store, opened.doc_id, opened.root.node_id, 0).expect("get_children on root");
    println!(
        "get_children(root) -> page of {} (of {} total children) in {:?}",
        page.items.len(),
        page.total,
        start.elapsed()
    );
    assert_eq!(page.total, 1_178_422);
    assert!(page.has_more);
    assert!(page.items.len() <= crate::tree::CHILDREN_PAGE_SIZE);
    assert!(page.items.iter().all(|n| n.node_type == "element"), "whitespace text nodes should be filtered out");

    let first_item = page
        .items
        .first()
        .expect("at least one element in the first page");
    let start = Instant::now();
    let page = nodeset(
        evaluate_xpath(&store, opened.doc_id, opened.root.node_id, "//item", 0)
            .expect("evaluate_xpath //item"),
    );
    println!(
        "evaluate_xpath(//item) -> page of {} (of {} total matches) in {:?}",
        page.items.len(),
        page.total,
        start.elapsed()
    );
    // The whole point of paginating XPath: a 1.18M-match result must come back as
    // one bounded page, not the entire set serialized over IPC.
    assert_eq!(page.total, 1_178_422);
    assert!(page.has_more);
    assert!(page.items.len() <= crate::tree::CHILDREN_PAGE_SIZE);

    let xml = get_formatted_outer_xml(&store, opened.doc_id, first_item.node_id)
        .expect("get_formatted_outer_xml on first item");
    assert!(xml.contains("Widget 0"));
}
