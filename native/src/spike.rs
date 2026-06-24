use libxml::parser::Parser;
use libxml::xpath::Context;
use std::time::Instant;

pub fn open_and_query(path: &str, xpath: &str) -> Result<Vec<String>, String> {
    let start = Instant::now();
    let parser = Parser::default();
    let doc = parser.parse_file(path).map_err(|e| e.to_string())?;
    let parse_time = start.elapsed();

    let context = Context::new(&doc).map_err(|_| "failed to create xpath context".to_string())?;
    let query_start = Instant::now();
    let result = context
        .evaluate(xpath)
        .map_err(|_| "xpath evaluation failed".to_string())?;
    let query_time = query_start.elapsed();

    let nodes = result.get_nodes_as_vec();
    eprintln!(
        "spike: parse={:?} query={:?} matches={}",
        parse_time,
        query_time,
        nodes.len()
    );

    Ok(nodes.iter().map(|n| n.get_name()).collect())
}

#[tauri::command]
pub fn spike_open_and_query(path: String, xpath: String) -> Result<Vec<String>, String> {
    open_and_query(&path, &xpath)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires SPIKE_FIXTURE=/path/to/large.xml; not part of the default fixture-driven suite"]
    fn spike_large_fixture() {
        let path = std::env::var("SPIKE_FIXTURE")
            .expect("set SPIKE_FIXTURE=/path/to/large.xml to run this test");
        let names = open_and_query(&path, "//item").expect("spike query failed");
        println!("matched {} nodes", names.len());
        assert!(!names.is_empty());
    }
}
