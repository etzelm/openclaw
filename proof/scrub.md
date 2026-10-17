# Scrub

Pure text substitution applied to every file of this directory (scratch state dirs are not published), in this order:

1. the scratch root (the proof directory under the openclaw user's home, work/t1-01-ev/proof) becomes `<scratch>`
2. any other path under the openclaw user's home becomes `<home>`
3. the machine short name (output of `hostname -s`) becomes `<host>`
4. the Gateway test token passed to `gateway run --token` and `gateway call --token` becomes `<test-token>`
5. the machine display name used by the Bonjour advertisement (a possessive first name plus "Mac Studio") becomes `<host-display-name>`
6. any em dash or en dash character becomes a plain hyphen

Consequence: the commands in `*.cmd` and `tools/` show `<scratch>`/`<home>` where the real absolute paths were; replace them to re-run. The synthetic workspace holds only generated lorem-style text; no private data was used.

Final check, run after the substitution (patterns use bracket tricks so this file is not needed in the exclusion for the name patterns; scrub.md itself is excluded from the grep because it documents the rules). Command:

```
grep -rnE '<home path>|<owner name>|<test token>|<token prefix>' . --exclude=scrub.md
perl -ne 'print if /\xe2\x80[\x93\x94]/' <every file other than scrub.md>
```

Output (empty means none remain):

```
(end of output)
```
