# Parity of memory search results (base vs patched)

Hash A = sha256 of JSON array of [path,startLine,endLine,score] in result order; Hash B = same without score. Source: `results` array of each `d<N>-search.out` (seal path, observer on).

| query | hits base | hits patched | hash A base | hash A patched | A equal | hash B base | hash B patched | B equal |
|---|---|---|---|---|---|---|---|---|
| saffron glacier orchard | 25 | 25 | b41508b9c1925511 | b41508b9c1925511 | true | ff2d1fbcd4fc6acf | ff2d1fbcd4fc6acf | true |
| lorem ipsum | 25 | 25 | c8b4dc845ff60dd8 | c8b4dc845ff60dd8 | true | a855b85add28b64d | a855b85add28b64d | true |
| copper willow | 25 | 25 | ebf7f74a0887ad21 | ebf7f74a0887ad21 | true | 0333e6762ca80ba6 | 0333e6762ca80ba6 | true |
| harbor lantern meadow | 25 | 25 | a01bd2347c449800 | a01bd2347c449800 | true | fff48abb76def49d | fff48abb76def49d | true |
| cobalt ember tundra | 25 | 25 | 847834bbc2cf6270 | 847834bbc2cf6270 | true | 499231eb9b30c092 | 499231eb9b30c092 | true |

## Full hashes and byte comparison

- saffron glacier orchard: full A base=b41508b9c1925511d8c1992bb5edbcfc93c50bf34e0519e7c9ff34a182106ac7 patched=b41508b9c1925511d8c1992bb5edbcfc93c50bf34e0519e7c9ff34a182106ac7; full B base=ff2d1fbcd4fc6acf1452120d341347e4f8fe9e96de01571300d7aa7fd086537d patched=ff2d1fbcd4fc6acf1452120d341347e4f8fe9e96de01571300d7aa7fd086537d; byte-identical stdout=false
- lorem ipsum: full A base=c8b4dc845ff60dd8645177030874627771c30aad8be9d0b932e3d99c10cb6114 patched=c8b4dc845ff60dd8645177030874627771c30aad8be9d0b932e3d99c10cb6114; full B base=a855b85add28b64d6b4962f13c7466f8dd07862151b5d0cfe8a3af32ce6db8b6 patched=a855b85add28b64d6b4962f13c7466f8dd07862151b5d0cfe8a3af32ce6db8b6; byte-identical stdout=false
- copper willow: full A base=ebf7f74a0887ad2111af8cb562bdf8c178efef6d64dc2794ffefa4feab862085 patched=ebf7f74a0887ad2111af8cb562bdf8c178efef6d64dc2794ffefa4feab862085; full B base=0333e6762ca80ba627af1c859c95755899beb2385bb243ea717a4f2958288c65 patched=0333e6762ca80ba627af1c859c95755899beb2385bb243ea717a4f2958288c65; byte-identical stdout=false
- harbor lantern meadow: full A base=a01bd2347c449800a312df744dfb1af78ac9a076544160077a7dc753f78dde67 patched=a01bd2347c449800a312df744dfb1af78ac9a076544160077a7dc753f78dde67; full B base=fff48abb76def49d4c24d2093b0ffc1df8c5089a5be4617eb5221feb2c5994a6 patched=fff48abb76def49d4c24d2093b0ffc1df8c5089a5be4617eb5221feb2c5994a6; byte-identical stdout=false
- cobalt ember tundra: full A base=847834bbc2cf62700e9b4f9bef463865370c14ff40d3f07c915b7f36113ca828 patched=847834bbc2cf62700e9b4f9bef463865370c14ff40d3f07c915b7f36113ca828; full B base=499231eb9b30c092ded08bb3b2bc59a30f826bc27ee9fd424e578ac7bc4e1b82 patched=499231eb9b30c092ded08bb3b2bc59a30f826bc27ee9fd424e578ac7bc4e1b82; byte-identical stdout=false

## Query 1 stdout byte-identical to base d1 (all other runs, incl. no-seal and timing runs)

- base/e-noseal-search: true
- base/e2-seal-search-deep: true
- base/f-seal-1: true
- base/f-noseal-1: true
- base/f-seal-2: true
- base/f-noseal-2: true
- base/f-seal-3: true
- base/f-noseal-3: true
- base/f-seal-4: true
- base/f-noseal-4: true
- base/f-seal-5: true
- base/f-noseal-5: true
- patched/e-noseal-search: false
- patched/e2-seal-search-deep: false
- patched/f-seal-1: false
- patched/f-noseal-1: false
- patched/f-seal-2: false
- patched/f-noseal-2: false
- patched/f-seal-3: false
- patched/f-noseal-3: false
- patched/f-seal-4: false
- patched/f-noseal-4: false
- patched/f-seal-5: false
- patched/f-noseal-5: false

## Stdout byte comparison note

Full stdout differs between arms only in the per-hit provenance field observedAt (differs between arms because each arm has its own workspace copy). Diff line count after removing observedAt lines (0 means identical):

- d1: 0
- d2: 0
- d3: 0
- d4: 0
- d5: 0
