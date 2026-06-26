#!/usr/bin/env python3
"""
mms - memory markdown search
Search your markdown files by keyword, heading, or tag.
A tool I built for myself because grep doesn't understand markdown structure.
"""

import argparse
import os
import re
import sys
from pathlib import Path
from difflib import SequenceMatcher

# ANSI colors
class C:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    CYAN = "\033[36m"
    UNDERLINE = "\033[4m"
    ITALIC = "\033[3m"

def color(text, *styles):
    return "".join(styles) + text + C.RESET

def find_heading(lines, line_num):
    """Walk backwards to find the nearest markdown heading."""
    for i in range(line_num - 1, -1, -1):
        if lines[i].startswith("#"):
            return lines[i].lstrip("#").strip()
    return ""

def highlight(text, query, case_sensitive):
    """Highlight matches in text."""
    flags = 0 if case_sensitive else re.IGNORECASE
    return re.sub(
        f"({re.escape(query)})",
        color(r"\1", C.RED, C.BOLD),
        text,
        flags=flags
    )

def search_file(filepath, query, args):
    """Search a single file, return list of matches."""
    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
    except (IOError, OSError):
        return []

    lines = content.split("\n")
    flags = 0 if args.case_sensitive else re.IGNORECASE
    pattern = re.compile(re.escape(query), flags)
    matches = []

    for i, line in enumerate(lines):
        is_match = False
        
        if args.headings:
            is_match = line.startswith("#") and pattern.search(line)
        elif args.tags:
            stripped = line.strip()
            is_match = (stripped.startswith("- ") or stripped.startswith("#")) and pattern.search(line)
        else:
            is_match = bool(pattern.search(line))
        
        if is_match:
            heading = find_heading(lines, i)
            ctx = args.context
            before = lines[max(0, i - ctx):i]
            after = lines[i + 1:min(len(lines), i + 1 + ctx)]
            
            matches.append({
                "file": filepath,
                "line_num": i + 1,
                "line": line,
                "before": before,
                "after": after,
                "heading": heading,
            })
    
    return matches

def search_file_fuzzy(filepath, query, args):
    """Fuzzy search - find lines that are semantically similar to the query."""
    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
    except (IOError, OSError):
        return []

    lines = content.split("\n")
    query_words = set()
    for q in re.split(r'[\s,，。.!！?？、]', query.lower()):
        if q:
            query_words.add(q)
    # Also add individual chars for Chinese (bigram-ish)
    if any('\u4e00' <= c <= '\u9fff' for c in query):
        for i in range(len(query)):
            if i + 1 < len(query):
                query_words.add(query[i:i+2].lower())
    
    matches = []

    for i, line in enumerate(lines):
        if not line.strip():
            continue
        
        line_lower = line.lower()
        line_words = set()
        for w in re.split(r'[\s,，。.!！?？、]', line_lower):
            if w:
                line_words.add(w)
        # Also add bigrams for Chinese
        for i in range(min(len(line_lower), 200)):
            if i + 1 < len(line_lower):
                if any('\u4e00' <= c <= '\u9fff' for c in line_lower[i:i+2]):
                    line_words.add(line_lower[i:i+2])
        
        # Word overlap score
        overlap = len(query_words & line_words) / max(len(query_words), 1)
        
        # Sequence similarity score
        seq_sim = SequenceMatcher(None, query_lower := query.lower(), line_lower[:200]).ratio()
        
        # Combined score
        score = 0.6 * overlap + 0.4 * seq_sim
        
        if score >= args.fuzzy_threshold:
            heading = find_heading(lines, i)
            ctx = args.context
            before = lines[max(0, i - ctx):i]
            after = lines[i + 1:min(len(lines), i + 1 + ctx)]
            
            matches.append({
                "file": filepath,
                "line_num": i + 1,
                "line": line,
                "before": before,
                "after": after,
                "heading": heading,
                "score": score,
            })
    
    # Sort by score descending
    matches.sort(key=lambda m: m["score"], reverse=True)
    return matches

def format_match(m, query, case_sensitive, base_dir):
    """Format a single match for display."""
    output = []
    
    # File header (only printed once per file, handled by caller)
    rel_path = os.path.relpath(m["file"], base_dir)
    output.append(color(f"  {m['line_num']:>4} ", C.GREEN) + highlight(m["line"], query, case_sensitive))
    
    for j, line in enumerate(m["after"]):
        num = m["line_num"] + 1 + j
        output.append(color(f"  {num:>4} ", C.DIM) + color(line, C.DIM))
    
    return "\n".join(output)

def main():
    parser = argparse.ArgumentParser(
        prog="mms",
        description="memory markdown search - search your markdown files by keyword, heading, or tag"
    )
    parser.add_argument("query", help="Search query")
    parser.add_argument("-d", "--dir", default=".", help="Directory to search (default: .)")
    parser.add_argument("-H", "--headings", action="store_true", help="Search in headings only")
    parser.add_argument("-t", "--tags", action="store_true", help="Search in tags only")
    parser.add_argument("-c", "--context", type=int, default=2, help="Context lines (default: 2)")
    parser.add_argument("-s", "--case-sensitive", action="store_true", help="Case sensitive")
    parser.add_argument("-l", "--list", action="store_true", help="List matching files only")
    parser.add_argument("-f", "--fuzzy", action="store_true", help="Fuzzy match (find similar, not just exact)")
    parser.add_argument("--fuzzy-threshold", type=float, default=0.6, help="Fuzzy match threshold 0-1 (default: 0.6)")
    
    args = parser.parse_args()
    
    search_dir = Path(args.dir)
    if not search_dir.exists():
        print(color("error: ", C.RED, C.BOLD) + f"Directory not found: {args.dir}")
        sys.exit(1)
    
    all_matches = []
    
    for root, dirs, files in os.walk(search_dir):
        # Skip hidden dirs and node_modules
        dirs[:] = [d for d in dirs if not d.startswith(".") and d != "node_modules" and d != "target"]
        
        for fname in files:
            if fname.endswith(".md"):
                filepath = os.path.join(root, fname)
                if args.fuzzy:
                    all_matches.extend(search_file_fuzzy(filepath, args.query, args))
                else:
                    all_matches.extend(search_file(filepath, args.query, args))
    
    if not all_matches:
        print(color("→ ", C.DIM) + f'No matches found for "{color(args.query, C.YELLOW)}"')
        return
    
    if args.list:
        files = sorted(set(m["file"] for m in all_matches))
        for f in files:
            rel = os.path.relpath(f, args.dir)
            count = sum(1 for m in all_matches if m["file"] == f)
            print(f"  {color(rel, C.CYAN, C.UNDERLINE)} ({count} matches)")
        return
    
    # Group by file
    current_file = None
    for m in all_matches:
        if m["file"] != current_file:
            current_file = m["file"]
            rel = os.path.relpath(m["file"], args.dir)
            print(f"\n📄 {color(rel, C.CYAN, C.UNDERLINE)}")
        
        if m["heading"]:
            print(f"  {color('§', C.DIM)} {color(m['heading'], C.BLUE, C.ITALIC)}")
        
        # Context before
        for j, line in enumerate(m["before"]):
            num = m["line_num"] - len(m["before"]) + j
            print(color(f"  {num:>4} ", C.DIM) + color(line, C.DIM))
        
        # Matched line
        print(color(f"  {m['line_num']:>4} ", C.GREEN) + highlight(m["line"], args.query, args.case_sensitive))
        
        # Context after
        for j, line in enumerate(m["after"]):
            num = m["line_num"] + 1 + j
            print(color(f"  {num:>4} ", C.DIM) + color(line, C.DIM))
    
    total = len(all_matches)
    files = len(set(m["file"] for m in all_matches))
    print(f"\n{color('→', C.DIM)} {color(str(total), C.GREEN)} match{'es' if total != 1 else ''} in {files} file{'s' if files != 1 else ''}")

if __name__ == "__main__":
    main()
