# Parity of memory search results (base vs patched), real store copies

Hash A = sha256 of JSON array of [path,startLine,endLine,score] in result order; Hash B = same without score (same code as runA summarize.mjs). Raw stdout stays on the studio.

Variants: s5 = config N (provider none, spec config), each query on its own fresh cp -c -R of state-migrated-pristine (first process, no seal). s4 = config N, three queries in sequence on one working state (q1 first process, q2/q3 after the sync of q1 and with a valid seal). mnoseal = config M (provider/model/sources/tokenizer copied from the store meta, embedding endpoint unreachable so the repair fails and the index is left unchanged), fresh clone per query, no seal. mseal = config M, in-place sequential runs on one sealed state (seal reused).

## store dev

| variant | query | hits base | hits patched | hash A base | hash A patched | A equal | hash B equal | stdout sha256 equal |
|---|---|---|---|---|---|---|---|---|
| s5 | the project | 0 | 0 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | true | true | true |
| s5 | config | 0 | 0 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | true | true | true |
| s5 | memory | 0 | 0 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | true | true | true |
| s4 | the project | 0 | 0 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | true | true | true |
| s4 | config | 0 | 0 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | true | true | true |
| s4 | memory | 0 | 0 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | true | true | true |
| mnoseal | the project | 25 | 25 | 36c689784886096069bbf5b78236195dfd7671f335b3a2f58c9dbdc98cb6fedd | ad51e4a7a1dc9e70cd0ba7053ce50fa891fef7bdd14cdfee0700adf9176fdba4 | false | true | false |
| mnoseal | config | 25 | 25 | cced510ea1a6c3401372a9db4e43a9af0bb4330900477c144ef5efbe81abda6a | 520d61f1d7ee772bbaa4333846119293630011df2a74fcc421738d4076dac972 | false | true | false |
| mnoseal | memory | 25 | 25 | fbaa36579a168d52f246930acade8ede63a8ee521c82bc71567c604c03b2d596 | 4673f26696098ddc9c7e1f0e952e271b8fb7ef9250306e5c6661800e8b3f73d5 | false | true | false |
| mseal | the project | 25 | 25 | ae768d2e7aa5deb2fbb128895341d3ec5b98b2206333f0cd25c2ba6a873d3647 | 892db8f1dd37e781789f8107cf26b27cc94a4b79ffd569349e9751392781fc33 | false | true | false |
| mseal | config | 25 | 25 | 9a5f004e13a4fdb4cbba0277faaf55c05120372ab9d395236e60c3196e9aec83 | 4c282c7e6cca3f48fc18f75ac7e10bf67db5be225956b29f8c56286c7a7dbdc4 | false | true | false |
| mseal | memory | 25 | 25 | ad53807ff291db5cadbc7855d25bcf08726a82f29fa98291207e9c049327a838 | 32264a20858d586dc85c82d06569585df7a2fa0c15c43a4869874706d856d67d | false | true | false |

## store main

| variant | query | hits base | hits patched | hash A base | hash A patched | A equal | hash B equal | stdout sha256 equal |
|---|---|---|---|---|---|---|---|---|
| s5 | the project | 0 | 0 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | true | true | true |
| s5 | config | 0 | 0 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | true | true | true |
| s5 | memory | 0 | 0 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | true | true | true |
| s4 | the project | 0 | 0 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | true | true | true |
| s4 | config | 0 | 0 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | true | true | true |
| s4 | memory | 0 | 0 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | true | true | true |
| mnoseal | the project | 0 | 0 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | true | true | true |
| mnoseal | config | 0 | 0 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | true | true | true |
| mnoseal | memory | 0 | 0 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | true | true | true |
| mseal | the project | 0 | 0 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | true | true | true |
| mseal | config | 0 | 0 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | true | true | true |
| mseal | memory | 0 | 0 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 | true | true | true |

Note: where hits are 0 the hashes are the hash of an empty list and equality is vacuous; the stdout column then compares the whole output (warning text) byte for byte.

## Score drift (dev store, config M, hits > 0)

Hash A differs between arms only through the score field: result order, paths and line ranges (hash B) are identical. Scores are not run-to-run stable even within one arm (a time-dependent term), so max |score diff| is shown across arms and across two runs of the same arm.

| query | max abs score diff base vs patched (mnoseal) | max abs diff base mnoseal vs base mseal | max abs diff patched mnoseal vs patched mseal | position differences base vs patched |
|---|---|---|---|---|
| the project | 2.28e-5 | 2.95e-4 | 2.77e-4 | 0 |
| config | 2.14e-5 | 2.75e-4 | 2.59e-4 | 0 |
| memory | 2.23e-5 | 2.86e-4 | 2.69e-4 | 0 |

Main store: every variant returns 0 hits for both arms (see sync section of observer-summary and counts.md). With the spec config N (provider none) the stored chunks were embedded by a real provider, so the index identity mismatches and a repair is requested; with config M the embedding endpoint is unreachable so the search returns an empty list flagged stale. The main parity is therefore a statement about empty results and identical stdout, not about ranked hits.
