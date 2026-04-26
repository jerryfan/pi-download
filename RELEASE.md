# pi-download Release Plan (lean, npm-first)

## 1) Quality gate (manual)

Verify in a real Pi session:

- `/reload` loads extension cleanly
- `/dl doctor` reports OK (or actionable issues)
- `/dl <url>` downloads a bundle into your system Downloads folder
- Prose transcript `.txt` preserves the exact subtitle words (no paraphrasing)

## 2) Pack

From the repo folder:

```bash
npm pack --dry-run
```

## 3) Publish

```bash
npm publish --access public
```

## 4) GitHub release checklist

- Ensure README includes install snippet: `pi install npm:pi-download`
- Tag: `v<version>`
- GitHub release notes include changelog excerpt
