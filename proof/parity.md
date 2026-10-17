# Parity

Hash = sha256 of JSON [[path,startLine,endLine,score],...] over `results` in result order (25 max, 25 returned for each query).

| query | CLI before | CLI after | GW before c1 | GW before t1 | GW before t2 | GW after c1 | GW after t1 | GW after t2 | all equal |
|---|---|---|---|---|---|---|---|---|---|
| saffron glacier orchard | b41508b9c1925511 | b41508b9c1925511 | b41508b9c1925511 | b41508b9c1925511 | b41508b9c1925511 | b41508b9c1925511 | b41508b9c1925511 | b41508b9c1925511 | true |
| lorem ipsum | c8b4dc845ff60dd8 | c8b4dc845ff60dd8 | c8b4dc845ff60dd8 | c8b4dc845ff60dd8 | c8b4dc845ff60dd8 | c8b4dc845ff60dd8 | c8b4dc845ff60dd8 | c8b4dc845ff60dd8 | true |
| copper willow | ebf7f74a0887ad21 | ebf7f74a0887ad21 | ebf7f74a0887ad21 | ebf7f74a0887ad21 | ebf7f74a0887ad21 | ebf7f74a0887ad21 | ebf7f74a0887ad21 | ebf7f74a0887ad21 | true |
| harbor lantern meadow | a01bd2347c449800 | a01bd2347c449800 | a01bd2347c449800 | a01bd2347c449800 | a01bd2347c449800 | a01bd2347c449800 | a01bd2347c449800 | a01bd2347c449800 | true |
| cobalt ember tundra | 847834bbc2cf6270 | 847834bbc2cf6270 | 847834bbc2cf6270 | 847834bbc2cf6270 | 847834bbc2cf6270 | 847834bbc2cf6270 | 847834bbc2cf6270 | 847834bbc2cf6270 | true |

All CLI and gateway hashes equal across arms and runs: true. Every one of the 30 calls in each of the 6 gateway runs equals the hash of its query's first call: true.
First 16 hex chars shown; full hashes are recomputable with tools/report.mjs from the saved .out files.

Call exit codes: before/c1: 31/31 calls exit 0; before/t1: 31/31 calls exit 0; before/t2: 31/31 calls exit 0; after/c1: 31/31 calls exit 0; after/t1: 31/31 calls exit 0; after/t2: 31/31 calls exit 0.
