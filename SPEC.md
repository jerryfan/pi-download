---
id: pi-download
title: pi-download (pi extension) — SPEC
version: 0.1.0
status: public
tags: [pi, extension, youtube, downloader, subtitles, transcript]
distribution: public
---

# pi-download (pi extension) — SPEC

## 0) What this is (in one sentence)
`pi-download` is a public Pi extension whose `/dl <url>` happy path turns a YouTube URL into a durable local bundle in the user’s **system Downloads folder**, with short labeled names, containing a high-quality video file, a separate audio file, raw subtitle files, and a cleaned prose subtitle transcript whose body preserves subtitle words exactly while removing subtitle noise such as rolling duplicates.

---

## 1) Canon (95% bar; 190+/199)

### 1.1 Objective
Deliver a Pi-native download workflow that feels boringly reliable:
- one URL in,
- one predictable output bundle out,
- no subtitle paraphrasing,
- no mystery temp files,
- no fragile manual post-processing.

### 1.2 Quality gate
This extension is considered ready only when:
- `download_score >= 190/199` (see §11), and
- MVP acceptance criteria pass (see §12).

### 1.3 Hard constraints
- **Provider scope starts with YouTube only**.
  - Support standard YouTube watch URLs and Shorts URLs in v1.
  - Playlists, channels, and multi-URL batch flows are explicitly out of MVP.
- **No DRM or access-bypass behavior**.
  - The extension MUST NOT claim support for DRM, private, member-only, paywalled, or otherwise protected content.
- **Subtitle fidelity is a hard boundary**.
  - The cleaned prose transcript MUST NOT paraphrase, summarize, translate, reorder, or silently correct subtitle text.
  - Allowed changes are limited to formatting, whitespace normalization, paragraphing, and audited duplicate/overlap collapse (see §7).
- **Pinned inference is the default, but verifier-gated**.
  - Default inference model: `openai-codex/gpt-5.4-mini`.
  - Default inference thinking: `medium`.
  - Model output is always an untrusted proposal.
  - Any model-produced transcript body that cannot be verified for lexical fidelity MUST be rejected.
- **External binaries are explicit dependencies**.
  - v1 assumes `yt-dlp` and `ffmpeg` are available.
  - Missing dependencies MUST fail clearly via `/dl doctor` and at runtime.
- **Durable outputs are intentional; scratch is not**.
  - Final requested artifacts live in the user-selected output folder.
  - Partial downloads, caches, and transient transformation scratch MUST stay outside the repo unless explicitly promoted.
- **Headless-safe behavior**.
  - The extension MUST work without interactive UI, returning a machine-readable result and a concise textual summary.

---

## 2) Jobs to be done

### 2.1 Primary user jobs
1. **Archive a video locally** at a practical high quality without manually juggling tools.
2. **Keep a separate audio artifact** for reuse in transcription, clipping, or listening workflows.
3. **Preserve the source subtitles** exactly as downloaded for auditability.
4. **Read the subtitles as prose** instead of subtitle fragments, without changing the underlying words.
5. **Use the workflow naturally inside Pi** via a command or an LLM-callable tool.

### 2.2 Non-goals in v1
- content summarization
- transcript polishing for style
- speaker diarization
- translation
- media editing, clipping, or remixing
- playlist/channel ingestion
- OCR or ASR when subtitles do not exist

---

## 3) Scope

### 3.1 MUST ship in v1
1. **A command surface**
   - `/dl <url>` (happy path)
   - `/dl doctor`
   - `/download ...` MAY exist as a verbose/compat alias but MUST NOT be the primary happy path
2. **A model-callable tool** so the LLM can fulfill natural requests without forcing the user into slash-command syntax.
3. **Video download** at a fairly high default resolution.
   - Default target: best practical video at or below `1080p`, unless the user overrides it.
4. **Separate audio download**.
5. **Subtitle acquisition** with explicit precedence rules.
6. **Prose transcript cleanup** under a strict lexical-fidelity contract.
7. **A manifest** describing what was requested, what was found, what was produced, and what was verified.

### 3.2 SHOULD ship in v1 if cheap enough
- requested subtitle language override
- resumable partial downloads
- visible phase/progress status in interactive mode
- deterministic output folder naming based on title slug + video id

### 3.3 NOT in v1
- playlists, channels, subscriptions, or RSS-like monitoring
- concurrent multi-download orchestration
- browser auth/session scraping
- downloading comments, thumbnails, chapters, or analytics as first-class artifacts
- transcript repair by inventing punctuation or words

---

## 4) Public Pi surface

### 4.1 Slash commands
#### `/dl <url>`
Happy path. Runs the full flow against one URL using current defaults and writes the bundle into the user’s **system Downloads folder** with short labeled names.

This command SHOULD be what users learn.

#### `/download <url>` (optional alias)
If implemented, it MUST behave equivalently to `/dl` or provide only additional advanced flags while keeping `/dl` as the primary path.

Expected behavior:
- inspect source metadata first
- resolve output root = system Downloads folder (unless overridden)
- choose a short labeled output folder and file base name
- download media + subtitles
- generate cleaned transcript
- return concise path summary

#### `/dl doctor`
Reports operator-grade readiness:
- `yt-dlp` present/missing
- `ffmpeg` present/missing
- inference model mode (`auto-cheapest | pinned | off`)
- writable output root
- known config path

### 4.2 Model-callable tool
Recommended name: `download_video_bundle`

Recommended parameters:
```ts
{
  url: string;
  outDir?: string;
  maxHeight?: number;          // default 1080
  subtitleLanguages?: string[]; // default inferred policy
  subtitleMode?: "manual-preferred" | "manual-only" | "auto-ok";
  proseTranscript?: boolean;   // default true
  overwrite?: "error" | "reuse" | "replace";
}
```

Tool contract:
- MUST return final artifact paths in structured `details`
- MUST explain missing subtitles or cleanup fallback without pretending success
- MUST be safe for headless and JSON mode

### 4.3 Prompt contract
The tool SHOULD expose:
- a short `promptSnippet` so the model knows it can fetch a video bundle from a URL
- tool-specific guidelines that tell the model to use this tool instead of improvising `bash` sequences for normal YouTube download requests

---

## 5) Artifact contract

### 5.1 Output folder layout
Default durable layout (happy path):

```text
<downloads>/<label>-yt-<videoId>/
  manifest.json
  media/
    <label>-yt-<videoId>.video.<ext>
    <label>-yt-<videoId>.audio.<ext>
  subtitles/
    raw/
      <label>-yt-<videoId>.<lang>.<manual|auto>.vtt
    prose/
      <label>-yt-<videoId>.<lang>.txt
      <label>-yt-<videoId>.<lang>.audit.json
```

Where:
- `<downloads>` is the user’s system Downloads directory (see §9)
- `<label>` is a short, human-readable, filesystem-safe label derived from the title (see §6.5)

### 5.2 Artifact rules
- `manifest.json` is the authoritative machine-readable summary.
- Raw subtitle files MUST be preserved exactly as downloaded whenever subtitles exist.
- The prose transcript file MUST contain:
  1) a **super tight header** (exactly two lines), then
  2) the transcript prose body.

Header format (two lines):
1. `yt=<videoId> lang=<lang> kind=<manual|auto> url=<url>`
2. `---`

Rules:
- The verifier contract applies to the prose **body only** (text after the `---` line).
- No additional metadata banners, headings, or model commentary are allowed.
- Audit data for cleanup MUST live in `<lang>.audit.json`, not inside the prose body.

### 5.3 Manifest schema (minimum)
```ts
{
  version: 1,
  extension: { name: "pi-download", version: string },
  source: {
    provider: "youtube",
    url: string,
    videoId: string,
    title?: string,
    channel?: string,
    durationSec?: number
  },
  request: {
    outDir: string,
    maxHeight: number,
    subtitleLanguages: string[],
    subtitleMode: string,
    proseTranscript: boolean,
    overwrite: string
  },
  selectedFormats: {
    video?: { formatId: string, ext: string, height?: number },
    audio?: { formatId: string, ext: string, abr?: number },
    subtitles: Array<{ language: string, kind: "manual" | "auto", ext: string }>
  },
  outputs: {
    videoPath?: string,
    audioPath?: string,
    rawSubtitlePaths: string[],
    proseTranscriptPaths: string[],
    auditPaths: string[]
  },
  cleanup: {
    mode: "heuristic" | "llm-assisted" | "fallback-heuristic",
    model?: string,
    verifierPassed: boolean,
    duplicateSpanCount: number
  }
}
```

---

## 6) Download policy

### 6.1 Inspect-first flow
The extension MUST inspect metadata before downloading durable artifacts.

Required reasons:
- choose sane formats deliberately
- resolve subtitle availability before promising prose output
- produce a truthful manifest
- fail early for unsupported URLs or missing media

### 6.2 Video selection policy
Default policy:
- target the best practical visual quality at or below `1080p`
- prefer a broadly playable final artifact
- prefer `mp4` output when feasible
- allow source-native fallback when `mp4` is not reasonably available

Explicitly acceptable behavior:
- choose a separate video stream plus separate audio stream, then mux if needed
- return the actual chosen format in the manifest instead of hiding compromise

### 6.3 Audio selection policy
- download the best available standalone audio track
- prefer a durable, common playback format when feasible
- record actual selected audio format in the manifest

### 6.4 Subtitle selection policy
Default precedence for each requested language:
1. requested **manual** subtitle
2. source/original **manual** subtitle
3. requested **auto** subtitle
4. source/original **auto** subtitle

Rules:
- manual subtitles are preferred over auto-generated subtitles
- if no requested language is supplied, prefer source/original language
- if subtitles are absent, the extension MUST still succeed for media download and mark transcript outputs as unavailable

### 6.5 Naming and overwrite policy
#### Label / short-name policy
- Output folder name format: `<label>-yt-<videoId>`
- `<label>` MUST be:
  - short (target <= 32 chars)
  - ASCII, filesystem-safe (`[a-z0-9-]`)
  - derived from title, not invented content
  - stable for the same `(title, videoId)` input

If a cheap inference model is enabled, it MAY propose `<label>` as a JSON field.
The runtime MUST still enforce the safety/length rules and MUST fall back to a deterministic slugger if the model output is invalid.

#### Overwrite / idempotency policy
- Happy-path `/dl` MUST be non-erroring for common reruns.
- Default overwrite behavior: `reuse`.
  - If the target folder exists and contains a manifest for the same `videoId`, the extension SHOULD reuse completed artifacts.
  - If the folder exists but does not match the target `videoId`, create a new folder by suffixing `-2`, `-3`, ...
- `replace` MUST be explicit and MUST be destructive only inside the resolved target folder.

---

## 7) Subtitle-to-prose contract

This is the defining quality bar for the extension.

### 7.1 Input assumption
The source subtitle file may contain:
- line breaks inside one spoken sentence
- rolling captions that repeat earlier text fragments
- duplicate adjacent cues
- auto-caption punctuation gaps
- bracketed non-speech tags such as `[Music]`

The extension MUST treat these as source text, not as permission to rewrite meaning.

### 7.2 Allowed transformations
The prose cleaner MAY:
- remove subtitle cue timing and numbering
- normalize whitespace
- convert hard line breaks into spaces
- insert paragraph breaks (blank lines)
- insert sentence punctuation (`.`, `,`, `?`, `!`) to make the text read as prose
- merge adjacent cues into paragraphs
- collapse **exact duplicate adjacent spans**
- collapse **exact rolling-overlap spans** when a later cue repeats the tail of the previous cue verbatim

### 7.3 Forbidden transformations
The prose cleaner MUST NOT:
- replace a word with a synonym
- delete a non-duplicate word for readability
- add missing words
- change word casing (e.g., `Hello` → `hello`)
- translate
- summarize
- reorder phrases or sentences
- invent speaker labels or headings
- silently drop bracketed tags or non-speech tokens unless they are part of an exact duplicate span removal recorded in audit

Note: punctuation insertion is allowed, but only when the word sequence is unchanged and the verifier passes.

### 7.4 LLM role (default inference mode)
When inference is enabled (default), the cheapest available model MAY be used only for **structure inference** and naming proposals, not for freeform rewriting.

Permitted model outputs:
- paragraph break hints
- duplicate-span candidates
- overlap-collapse candidates
- cue grouping hints

Required operating mode:
- temperature MUST be low/deterministic
- output format MUST be strict JSON
- the runtime MUST treat model output as an untrusted proposal
- the verifier decides final acceptance

### 7.5 Verifier gate
Every cleaned transcript MUST pass a lexical-fidelity verifier before it is accepted as the final prose transcript body.

The verifier MUST confirm (for the prose body only):
- output text is derivable from the raw subtitle token stream
- removed spans are exact duplicates or exact overlaps only
- token order is preserved
- no novel lexical tokens were introduced

If the verifier fails:
- the model-assisted rewrite MUST be discarded
- the extension MUST fall back to deterministic heuristic cleanup
- if heuristic cleanup also fails verification, the extension MUST keep raw subtitles only and mark prose cleanup as failed in the manifest and audit file

### 7.6 Audit file
`<lang>.audit.json` MUST record enough detail to explain exactly what changed.

Minimum contents:
```ts
{
  version: 1,
  sourceLanguage: string,
  mode: "heuristic" | "llm-assisted" | "fallback-heuristic",
  verifierPassed: boolean,
  removedDuplicateSpans: Array<{
    kind: "adjacent-duplicate" | "rolling-overlap",
    fromCue: number,
    toCue: number,
    text: string
  }>,
  stats: {
    rawCueCount: number,
    rawTokenCount: number,
    outputTokenCount: number,
    paragraphCount: number
  },
  failureReason?: string
}
```

### 7.7 Human-readable result definition
A transcript counts as "human-readable prose" when:
- it reads as sentences (not a word stream)
- it is grouped into paragraphs (blank-line separated)
- repeated rolling-caption noise is collapsed
- it still preserves the original word sequence boundary defined above

If the source captions have weak punctuation, the result may still read rough.
That is acceptable. Fidelity beats polish.

---

## 8) Architecture overview

### 8.1 Components
`pi-download` consists of:
1. **Pi adapter**
   - registers the command and tool surface
   - renders progress/status updates
2. **Source inspector**
   - probes metadata and available formats/subtitles
3. **Download engine**
   - wraps `yt-dlp` and `ffmpeg`
   - stages durable outputs into the target folder
4. **Subtitle parser**
   - ingests VTT/SRT-equivalent subtitle text into cue objects
5. **Prose cleanup engine**
   - deterministic dedupe + paragraphing
   - optional low-cost model for structure hints
   - strict verifier gate
6. **Manifest/audit writer**
   - emits machine-readable provenance for the result bundle

### 8.2 Execution phases
1. validate inputs and dependencies
2. inspect metadata
3. resolve output folder
4. download video
5. download audio
6. download subtitles
7. clean subtitles into prose
8. write manifest + audit
9. return concise final summary

### 8.3 Progress model
Interactive mode SHOULD surface phases like:
- `inspect`
- `video`
- `audio`
- `subtitles`
- `prose`
- `finalize`

Headless mode MUST still emit enough text/details for operators to know where failure occurred.

---

## 9) Configuration

### 9.1 Config file
Recommended config path:
`~/.pi/agent/pi-download.json`

### 9.1.1 Default output root
If `defaultOutputRoot` is not set, the extension MUST default to the user’s system Downloads folder:
- Windows: `%USERPROFILE%\\Downloads`
- macOS: `~/Downloads`
- Linux: `XDG_DOWNLOAD_DIR` (from `~/.config/user-dirs.dirs`) if available, else `~/Downloads`

### 9.2 Recommended config keys
```json
{
  "defaultOutputRoot": null,
  "maxHeight": 1080,
  "subtitleLanguages": [],
  "subtitleMode": "manual-preferred",
  "proseTranscript": true,
  "overwrite": "reuse",
  "inferenceModelMode": "pinned",
  "pinnedInferenceModel": "openai-codex/gpt-5.4-mini",
  "inferenceThinking": "medium"
}
```

### 9.3 Model policy
Default: pinned inference model = `openai-codex/gpt-5.4-mini`, thinking = `medium`.

`inferenceModelMode` values:
- `pinned` — use the configured model id (recommended)
- `auto-cheapest` — pick the lowest-cost viable text model available, but MUST avoid `*spark*` models when alternatives exist
- `off` — disable model assistance and use deterministic heuristics only

Rules:
- The extension MUST NOT use `*spark*` as the inference model when the user asked for `gpt-5.4-mini`.
- The extension MUST run all inference calls with thinking level `medium` (unless the user overrides config).
- the extension MUST NOT change the user’s active chat model.
- the inference model is an internal helper, not a session-wide model switch.
- if the configured model is unavailable, the extension MUST fall back predictably and say so.

---

## 10) Safety, failure, and compliance

### 10.1 Dependency failures
Missing `yt-dlp` or `ffmpeg` MUST:
- fail fast
- explain exactly what is missing
- be visible in `/dl doctor`

### 10.2 Content-access failures
If the source is:
- private
- geo-blocked
- age-gated beyond available access
- removed
- DRM-protected

then the extension MUST fail honestly and MUST NOT imply that bypass is supported.

### 10.3 Subtitle absence
If subtitles do not exist:
- media download MAY still succeed
- manifest MUST say subtitles were unavailable
- no prose transcript file should be fabricated

### 10.4 Abort behavior
If the user aborts mid-run:
- partial temp state SHOULD be cleaned up when safe
- completed durable artifacts MAY remain if already finalized
- the manifest or summary MUST not claim full success

### 10.5 Network and retry behavior (ban-avoidance posture)
- the extension MUST set `--no-playlist` for YouTube URLs
- the extension SHOULD be conservative by default:
  - no parallel fragment downloading
  - small sleep interval between requests
  - bounded retries
- transient network failures SHOULD be retried within reason
- repeated failure MUST stop with a clear phase-specific error
- the extension MUST NOT silently loop forever

### 10.6 Security posture
- no browser-cookie scraping in MVP
- no hidden shell scripts beyond explicit dependency use
- no outbound upload of downloaded media or transcript contents
- subtitle cleanup model calls, if enabled, are the only optional external inference step and MUST stay within the transcript-cleanup scope

---

## 11) Scoring rubric (`download_score`)

Score is 0–199 and MUST be computed from explicit checks.

### 11.1 Download completeness (50 pts)
- (20) video artifact created at requested/default quality policy
- (15) separate audio artifact created
- (15) subtitle acquisition follows documented precedence and is truthfully reported

### 11.2 Transcript fidelity (70 pts)
- (25) verifier prevents paraphrase or lexical drift (body only)
- (20) duplicate/overlap removals are audit-backed
- (15) raw subtitles are preserved and prose failure never destroys source recoverability
- (10) tight header exists and is excluded from verifier scope

### 11.3 UX and Pi integration (45 pts)
- (20) `/dl <url>` happy path is truly zero-config and defaults to system Downloads folder
- (10) `/dl doctor` is accurate and operator-grade
- (10) manifest + audit are concise and truthful
- (5) phase/progress reporting is legible

### 11.4 Safety and operations (34 pts)
- (12) overwrite/idempotency is deterministic and non-destructive outside target folder
- (12) no unsupported-access claims or hidden upload side effects
- (10) dependency readiness is surfaced early (doctor + runtime)

**95% requirement:** must score `>=190/199` with no category below 80% of its own points.

---

## 12) Acceptance criteria (MVP-level)

### Functional
- A public YouTube URL with manual subtitles produces:
  - one durable video artifact
  - one durable audio artifact
  - at least one raw subtitle file
  - one cleaned prose transcript
  - one manifest
  - one transcript audit file
- A public YouTube URL with only auto subtitles still produces a cleaned transcript if subtitles are downloadable.
- A public YouTube URL with no subtitles still produces media artifacts and an honest manifest.

### Fidelity
- The final transcript body passes the lexical verifier.
- The transcript body reads as prose: sentences + paragraphs (not a cue dump).
- No accepted transcript body contains invented words, reordered phrases, casing changes, or unrecorded removals.
- Every duplicate-removal action is listed in the audit file.

### UX
- `/dl doctor` correctly reports dependency readiness.
- `/dl <url>` returns a concise completion summary with clear paths.
- The model-callable tool returns structured paths in `details`.

### Dogfood gate (gold standard)
- Running `/dl https://youtu.be/v2l0HZwwzfo?si=0Npu4rKA9d94mVwY` produces a bundle in the system Downloads folder with:
  - video + audio
  - raw subtitles (manual preferred)
  - a prose `.txt` transcript whose body reads as sentences/paragraphs and passes the word-fidelity verifier.

### Safety
- Unsupported or inaccessible content fails honestly.
- The extension never claims transcript success when only raw subtitles exist.
- The extension does not change the active session model while using a cheap helper model.

---

## 13) Changelog
| Version | Date | Change Type | Summary | Approved By |
|---|---|---|---|---|
| 0.1.0 | 2026-04-22 | major | initial spec for a public Pi extension that downloads YouTube media bundles and produces exact-word prose transcripts from subtitles | jerry |
