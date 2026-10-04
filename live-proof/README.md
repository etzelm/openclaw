# #154716 live behavior proof (redacted)

Files: `log-lines.txt` (the quoted log lines), `before-turn2-output.txt`, `after-turn2-output.txt`, `switch-turn2-output.txt` (full turn-2 captures: timestamp, exit code, answer line, the log lines for both turns).

Scenario: embedded one-shot `openclaw agent --local` against the real `claude-cli` backend and a real file-backed native Claude login, isolated OpenClaw state dir, no auth profile. Turn 1 stores a random codeword. The run's own Claude project dir (transcript and Claude auto-memory) is then deleted so turn 2 cannot `--resume`. Turn 2 (new process, same OpenClaw session id) asks for the codeword with tools forbidden.

Trees: BEFORE = origin/main parent `1836ae2146443e952337bce1bccb41c524ea0639` (`OpenClaw 2026.9.8 (1836ae2)`); AFTER = `de1dc67b0c2763eac77ec0ab351a738bc5fa7f89`, built from a local pre-amend commit with the identical tree (`OpenClaw 2026.9.8 (422eedf)`, tree `68cd262e555f563beeaf0057e3065f6b008485fd`). Both built on a separate Mac Studio, run on the Mac mini.

BEFORE was captured once and is reused (the `1836ae2` tree is unchanged). AFTER and SWITCH were captured again after the commit was amended to bound the owner recheck. A previous AFTER and SWITCH on `9f18fa05d00b` showed the same lines; those captures are not published.

| | refusal line | `historyPrompt` | promptChars | answer | tool calls |
|---|---|---|---|---|---|
| BEFORE | `reason=auth-unknown` | none | 292 | UNKNOWN | 0 |
| AFTER | absent | present | 762 | correct codeword | 0 |
| SWITCH | `reason=auth-unknown` | none | 251 | no answer (turn exited 1: `Failed to authenticate. API Error: 401 Invalid bearer token`) | n/a |

The turn-2 question wording was retyped for the re-run, so promptChars differ between rows; compare `historyPrompt`, not the counts.

Limits: SWITCH used a synthetic account record and fake token, so it shows no seeding, not a second real login. The log text is identical for no-owner and owner-differs; separately, the built AFTER code resolved that synthetic config to an owner of its own (`uuid:<synthetic>`) and to no owner when its credential file was removed, so the SWITCH refusal comes from the owner-differs path (inferred from that probe, not shown by the log line). `CLI history authority changed before execution` was not observed live (real-seam proof S3 covers it). File-backed login only; no Keychain-held login tested.

Redactions: absolute home paths, user and host account names, synthetic account ids and emails are omitted. Codewords are random per-run values.
