# Scrub

Applied to every copied text file (none are binary), in this order, pure substitutions (macOS sed):

```
find . -type f -exec sed -i '' -e 's#<scratch-root>#<scratch>#g' -e 's#<home-root>#<home>#g' {} +
```

The generated workspace and the sqlite databases were not copied.

Note: `<scratch-root>` and `<home-root>` above stand for the literal scratch directory and home directory on the run host; the literal values are not reproduced here. A later pass also replaced the machine name with `<host>` and the local gateway test token with `<test-token>` (`../redaction-check.out`).
