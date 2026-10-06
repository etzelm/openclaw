#!/usr/bin/env python3
"""Replay wiki_search queries against a memory-wiki vault on disk, read-only.

Usage: python3 -I prefilter-measure.py <vault-root> [--queries FILE]

For every page under sources/, entities/, concepts/, syntheses/ and reports/
the script builds two lowercased strings:

  meta = relative path + "\\n" + raw frontmatter text (between the --- lines)
  body = everything after the frontmatter

This is an offline stand-in for the compiled digest. It is NOT the string
buildDigestPageSearchText (extensions/memory-wiki/src/query.ts) builds: that
string holds title, path, id, selected frontmatter fields, topRelationships
and compiled claim text/ids/evidence kinds/privacy tiers, and it does not
hold frontmatter keys or fields the compiler drops. The two texts differ in
both directions, so the counts below are an approximation, not a bound.

Per query it reports:
  meta_phrase  pages whose meta contains the whole lowercased query
  meta_alltok  pages whose meta contains every query token (any order)
  body_alltok  pages whose meta+body contains every query token

Tokenizer mirrors buildQueryTokens for ASCII input: split on
[^\\w@._-]+, keep tokens of length >= 2, dedupe preserving order.

The query list is the set of distinct (query, maxResults) pairs an agent
issued through the wiki_search tool, with site-specific host, repo, file and
job names replaced by generic equivalents of the same token count.
"""
import argparse
from datetime import datetime
import json
import os
import re
import sys
import time

GROUPS = ["sources", "entities", "concepts", "syntheses", "reports"]

QUERIES = [
    ("3-2-1 backup", 8),
    ("Authentik", 10),
    ("Authentik forward auth protect service", 10),
    ("LINQ", 10),
    ("LM Studio MLX model setup studio mlxvlm DeepSeek server", 8),
    ("OpenWhispr VoiceInk Handy dictation comparison", 10),
    ("Traefik domain routing desktop container stack", 10),
    ("Workboard ticket system upstream OpenClaw work archived project", 8),
    ("offsite-backup min-age gitlab tar same night", 6),
    ("claude-cli session resume cwd invalidated history reseed", 5),
    ("gitlab", 6),
    ("env substitution config ${VAR} default syntax openclaw config-secrets-", 8),
    ("exec approvals policy full mode no-prompt YOLO", 8),
    ("gateway LaunchDaemon openclaw-service.plist system daemon vs LaunchAgent", 8),
    ("gateway upgrade restart hang stuck process launchd", 10),
    ("config.rb bind mount host-configs virtiofs stale", 6),
    ("models.mode replace claude-cli anthropic provider doctor stripped model routing", 6),
    ("infra-configs GitLab backup pipeline external-array gitlab-backup failure", 6),
    ("offsite backup Backblaze B2 Hyper Backup Time Machine restic", 8),
    ("openclaw update script desktop node laptop", 4),
    ("openclaw update upgrade upgrade-watch rollback", 5),
    ("openclaw upgrade wizard config model strip", 8),
    ("openwhispr whisper dictation transcription", 10),
    ("prometheus scrape openclaw gateway metrics", 4),
    ("requester settle wake subagent registry completion delivery", 10),
    ("desktop node full disk access node upgrade", 4),
    ("mac.example.lan Mac Studio LM Studio MLX local model serving", 8),
    ("subagent model selection DeepSeek local model delegation sonnet", 8),
    ("telegram subagent announce numeric chat id", 4),
    ("utility model claude-cli agentRuntime session observer isolated completion", 10),
    ("wiki nightly maintenance stall wiki-cron", 5),
]


def tokenize(query):
    return [t for t in dict.fromkeys(re.split(r"[^\w@._-]+", query.lower())) if len(t) >= 2]


def load_queries(path):
    out = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            query, _, mx = line.rpartition("\t")
            out.append((query, int(mx) if mx else 10))
    return out


def read_pages(root):
    pages = []
    nbytes = 0
    skipped = 0
    for group in GROUPS:
        for dirpath, _, files in os.walk(os.path.join(root, group)):
            for name in files:
                # Same file filter as listMemoryWikiPagePaths (bounded-walk.ts L45-58): *.md except index.md.
                # Differences from the production bounded walk: os.walk does not descend symlinked
                # directories but still lists symlinked files, whereas symlinkPolicy "skip"
                # (bounded-walk.ts L28) skips both; and the bounded walk throws past 20,000 entries
                # (bounded-walk.ts L9, L29) instead of continuing. So this count is an upper bound
                # on what a production full read lists.
                if not name.endswith(".md") or name == "index.md":
                    continue
                path = os.path.join(dirpath, name)
                # The vault is live: a memory-bridge sync can delete a page between the directory
                # listing and the read. Mirror query.ts L239-248, which returns null for not-found
                # and not-file, by skipping the page and counting it.
                try:
                    size = os.stat(path).st_size
                    with open(path, encoding="utf-8", errors="ignore") as fh:
                        raw = fh.read()
                except (FileNotFoundError, NotADirectoryError):
                    skipped += 1
                    continue
                nbytes += size
                rel = os.path.relpath(path, root)
                frontmatter = ""
                body = raw
                if raw.startswith("---"):
                    end = raw.find("\n---", 3)
                    if end > 0:
                        frontmatter = raw[3:end]
                        body = raw[end + 4 :]
                pages.append(((rel + "\n" + frontmatter).lower(), body.lower()))
    return pages, nbytes, skipped


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("vault_root", help="memory-wiki vault root (directory containing sources/, entities/, ...)")
    parser.add_argument("--queries", help="optional TSV file: <query>\\t<maxResults> per line; default is the embedded list")
    args = parser.parse_args(argv)

    queries = sorted(set(load_queries(args.queries) if args.queries else QUERIES))
    snapshot = datetime.now().astimezone().isoformat(timespec="seconds")
    started = time.time()
    pages, nbytes, skipped = read_pages(args.vault_root)
    elapsed = time.time() - started
    print(
        f"snapshot={snapshot} pages={len(pages)} skipped={skipped} bytes={nbytes / 1e6:.0f}MB read={elapsed:.1f}s "
        "(python, read only, no YAML/markdown parse; bytes is os.stat file size; "
        "vault is live and changes with memory-bridge syncs)"
    )

    agg = {"phrase0": 0, "underfill_phrase": 0, "underfill_token": 0}
    print(f'{"terms":>5} {"max":>3} {"meta_phrase":>11} {"meta_alltok":>11} {"body_alltok":>11}  query')
    for query, mx in queries:
        ql = query.lower()
        tokens = tokenize(query)
        phrase = sum(1 for meta, _ in pages if ql in meta)
        meta_alltok = sum(1 for meta, _ in pages if tokens and all(t in meta for t in tokens))
        body_alltok = sum(1 for meta, body in pages if tokens and all(t in meta + "\n" + body for t in tokens))
        agg["phrase0"] += phrase == 0
        agg["underfill_phrase"] += phrase < mx
        agg["underfill_token"] += meta_alltok < mx
        print(f"{len(tokens):>5} {mx:>3} {phrase:>11} {meta_alltok:>11} {body_alltok:>11}  {query}")
    print(json.dumps(agg), "of", len(queries), "distinct queries")


if __name__ == "__main__":
    main(sys.argv[1:])
