# Contributing

## Local smoke test

1. Install locally:

```bash
pi install -l <path-to-pi-download>
```

2. In Pi:

```text
/reload
/dl doctor
```

3. Happy path:

```text
/dl <youtube-url>
```

4. Verify:
- A new folder appears under your system Downloads folder
- The bundle includes video/audio files and subtitle files (when available)
- The prose transcript `.txt` preserves the exact subtitle words (no paraphrasing)

## PR expectations

- Keep the single-command rule: only `/dl` as a top-level command
- Keep exact-word transcript fidelity
- Update `CHANGELOG.md` for user-visible changes
- Keep README concise and practical
