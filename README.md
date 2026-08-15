# pi-download

A Pi extension that turns a YouTube or Reddit URL into a local bundle, or a public Threads video post into an MP4, in your system Downloads folder.

Happy path:

```text
/dl <youtube-threads-or-reddit-url>
```

Doctor:

```text
/dl doctor
```

This extension uses `yt-dlp` and `ffmpeg`.

## Install

```bash
pi install npm:pi-download
```

Then:

```text
/reload
```
