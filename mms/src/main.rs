use clap::Parser;
use colored::*;
use regex::Regex;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// mms - memory markdown search
/// Search your markdown files by keyword, heading, or tag
#[derive(Parser, Debug)]
#[command(name = "mms", version = "0.1.0", about = "Search markdown files semantically")]
struct Args {
    /// Search query
    query: String,

    /// Directory to search (default: current directory)
    #[arg(short, long, default_value = ".")]
    dir: String,

    /// Search in headings only
    #[arg(short, long)]
    headings: bool,

    /// Search in tags only (lines starting with - or #tag)
    #[arg(short, long)]
    tags: bool,

    /// Show context lines around match
    #[arg(short, long, default_value = "2")]
    context: usize,

    /// Case sensitive search
    #[arg(short, long)]
    case_sensitive: bool,

    /// File pattern to search (default: *.md)
    #[arg(short, long, default_value = "*.md")]
    pattern: String,
}

struct Match {
    file: PathBuf,
    line_num: usize,
    line: String,
    context_before: Vec<String>,
    context_after: Vec<String>,
    heading: String,
}

fn find_heading(lines: &[String], line_num: usize) -> String {
    // Walk backwards to find the nearest heading
    for i in (0..line_num).rev() {
        let line = &lines[i];
        if line.starts_with('#') {
            return line.trim_start_matches('#').trim().to_string();
        }
    }
    String::new()
}

fn search_file(path: &Path, args: &Args, regex: &Regex) -> Vec<Match> {
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    let mut matches = vec![];

    for (i, line) in lines.iter().enumerate() {
        let search_line = if args.case_sensitive {
            line.clone()
        } else {
            line.to_lowercase()
        };

        let is_match = if args.headings {
            line.starts_with('#') && regex.is_match(&search_line)
        } else if args.tags {
            (line.trim_start().starts_with("- ") || line.trim_start().starts_with("#"))
                && regex.is_match(&search_line)
        } else {
            regex.is_match(&search_line)
        };

        if is_match {
            let before: Vec<String> = if i >= args.context {
                lines[i - args.context..i].to_vec()
            } else {
                lines[..i].to_vec()
            };
            let after: Vec<String> = if i + 1 + args.context <= lines.len() {
                lines[i + 1..i + 1 + args.context].to_vec()
            } else {
                lines[i + 1..].to_vec()
            };

            matches.push(Match {
                file: path.to_path_buf(),
                line_num: i + 1,
                line: line.clone(),
                context_before: before,
                context_after: after,
                heading: find_heading(&lines, i),
            });
        }
    }

    matches
}

fn highlight_match(line: &str, query: &str, case_sensitive: bool) -> String {
    let re = if case_sensitive {
        Regex::new(&regex::escape(query)).unwrap()
    } else {
        Regex::new(&format!("(?i){}", regex::escape(query))).unwrap()
    };
    re.replace_all(line, |caps: &regex::Captures| {
        caps[0].red().bold().to_string()
    })
    .to_string()
}

fn main() {
    let args = Args::parse();

    let query_lower = if args.case_sensitive {
        args.query.clone()
    } else {
        args.query.to_lowercase()
    };

    let regex = Regex::new(&regex::escape(&query_lower)).unwrap();

    let dir = Path::new(&args.dir);
    if !dir.exists() {
        eprintln!("{} Directory not found: {}", "error:".red().bold(), args.dir);
        std::process::exit(1);
    }

    let mut all_matches: Vec<Match> = vec![];

    for entry in WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext == "md" {
            all_matches.extend(search_file(path, &args, &regex));
        }
    }

    if all_matches.is_empty() {
        println!(
            "{} No matches found for \"{}\"",
            "→".dimmed(),
            args.query.yellow()
        );
        return;
    }

    // Group by file
    let mut current_file: Option<PathBuf> = None;
    for m in &all_matches {
        if current_file.as_ref() != Some(&m.file) {
            current_file = Some(m.file.clone());
            let rel_path = m.file.strip_prefix(dir).unwrap_or(&m.file);
            println!(
                "\n{} {}",
                "📄".to_string(),
                rel_path.display().to_string().cyan().underline()
            );
        }

        // Show heading if found
        if !m.heading.is_empty() {
            println!("  {} {}", "§".dimmed(), m.heading.blue().italic());
        }

        // Show context before
        for (i, line) in m.context_before.iter().enumerate() {
            let num = m.line_num - m.context_before.len() + i;
            println!(
                "  {} {}",
                format!("{:>4}", num).dimmed(),
                line.dimmed()
            );
        }

        // Show matched line
        let highlighted = highlight_match(&m.line, &args.query, args.case_sensitive);
        println!(
            "  {} {}",
            format!("{:>4}", m.line_num).green(),
            highlighted
        );

        // Show context after
        for (i, line) in m.context_after.iter().enumerate() {
            let num = m.line_num + 1 + i;
            println!(
                "  {} {}",
                format!("{:>4}", num).dimmed(),
                line.dimmed()
            );
        }
    }

    println!(
        "\n{} {} match{} found",
        "→".dimmed(),
        all_matches.len().to_string().green(),
        if all_matches.len() == 1 { "" } else { "es" }
    );
}
