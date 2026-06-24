use std::io::Write;
use std::time::Instant;

const DEFAULT_ITEM_COUNT: usize = 1_178_422;

fn generate_fixture(path: &str, item_count: usize) -> std::io::Result<()> {
    let mut f = std::io::BufWriter::new(std::fs::File::create(path)?);
    writeln!(f, "<?xml version=\"1.0\" encoding=\"UTF-8\"?>")?;
    writeln!(f, "<catalog>")?;
    for n in 0..item_count {
        let price = (n * 37 % 10000) as f64 / 100.0;
        writeln!(
            f,
            "  <item id=\"{n}\"><name>Widget {n}</name><price>{price:.2}</price><description>Lorem ipsum dolor sit amet, item number {n}, consectetur adipiscing elit.</description></item>"
        )?;
    }
    writeln!(f, "</catalog>")?;
    Ok(())
}

fn rss_mb(sys: &mut sysinfo::System, pid: sysinfo::Pid) -> f64 {
    sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
    sys.process(pid)
        .map(|p| p.memory() as f64 / 1024.0 / 1024.0)
        .unwrap_or(0.0)
}

fn bench_libxml2(fixture: &str, sys: &mut sysinfo::System, pid: sysinfo::Pid) {
    println!("=== libxml2 (current native engine) ===");
    let t0 = Instant::now();
    let parser = libxml::parser::Parser::default();
    let doc = match parser.parse_file(fixture) {
        Ok(doc) => doc,
        Err(e) => {
            println!("  parse failed: {e}");
            return;
        }
    };
    let parse_time = t0.elapsed();

    let t1 = Instant::now();
    let context = libxml::xpath::Context::new(&doc).expect("xpath context");
    let result = context.evaluate("//item").expect("xpath eval");
    let xpath_time = t1.elapsed();
    let count = result.get_nodes_as_vec().len();

    println!("  parse_time: {:?}", parse_time);
    println!("  xpath_time: {:?}", xpath_time);
    println!("  item_count: {count}");
    println!("  rss_after: {:.1} MB", rss_mb(sys, pid));
}

fn bench_xmloxide(fixture: &str, sys: &mut sysinfo::System, pid: sysinfo::Pid) {
    println!("=== xmloxide (pure-Rust alternative) ===");
    let t0 = Instant::now();
    let doc = match xmloxide::Document::parse_file(fixture) {
        Ok(doc) => doc,
        Err(e) => {
            println!("  parse failed: {e}");
            return;
        }
    };
    let parse_time = t0.elapsed();

    let root = doc.root_element().expect("root element");
    let t1 = Instant::now();
    let result = xmloxide::xpath::evaluate(&doc, root, "//item").expect("xpath eval");
    let xpath_time = t1.elapsed();
    let count = match result {
        xmloxide::xpath::XPathValue::NodeSet(nodes) => nodes.len(),
        _ => 0,
    };

    println!("  parse_time: {:?}", parse_time);
    println!("  xpath_time: {:?}", xpath_time);
    println!("  item_count: {count}");
    println!("  rss_after: {:.1} MB", rss_mb(sys, pid));
}

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.len() >= 2 && args[1] == "--generate" {
        let out_path = args.get(2).map(String::as_str).unwrap_or("fixture.xml");
        let item_count = args
            .get(3)
            .and_then(|s| s.parse().ok())
            .unwrap_or(DEFAULT_ITEM_COUNT);
        println!("Generating {item_count} items to {out_path}...");
        generate_fixture(out_path, item_count).expect("generate fixture");
        println!("Done.");
        return;
    }

    let fixture = args.get(1).map(String::as_str).unwrap_or_else(|| {
        eprintln!("usage: xmlexplorer-bench <fixture.xml>");
        eprintln!("       xmlexplorer-bench --generate <out.xml> [item_count]");
        std::process::exit(1);
    });

    println!("Benchmarking against: {fixture}");
    let meta = std::fs::metadata(fixture).expect("read fixture metadata");
    println!("File size: {:.1} MB\n", meta.len() as f64 / 1024.0 / 1024.0);

    let mut sys = sysinfo::System::new();
    let pid = sysinfo::get_current_pid().expect("current pid");

    bench_libxml2(fixture, &mut sys, pid);
    println!();
    bench_xmloxide(fixture, &mut sys, pid);
}
