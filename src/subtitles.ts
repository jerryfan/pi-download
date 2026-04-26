import { rename, writeFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DuplicateSpan, SelectedSubtitle, SubtitleCue, TranscriptAuditV1 } from "./types";

function decodeEntities(s: string): string {
	// Minimal HTML entity decoding commonly seen in YouTube VTT.
	return s
		.replace(/&gt;/g, ">")
		.replace(/&lt;/g, "<")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, "\"")
		.replace(/&#39;/g, "'");
}

function cleanCueText(raw: string): string {
	// Remove WebVTT inline timestamp tags and styling tags, normalize whitespace.
	// Keep only the readable cue text.
	let s = decodeEntities(String(raw ?? ""));
	// Remove speaker markers used by some captions (e.g. ">> Name:").
	s = s.replace(/>>/g, " ");
	// Strip any remaining standalone '>' that might remain after decoding.
	s = s.replace(/(^|\s)>+(?=\s|$)/g, " ");
	// Remove any VTT/HTML-ish tags like <00:00:00.320>, <c>, </c>, <v ...> etc.
	s = s.replace(/<[^>]+>/g, " ");
	// Collapse whitespace.
	s = s.replace(/\s+/g, " ").trim();
	return s;
}

function parseTimestampToMs(ts: string): number {
	// 00:00:01.234
	const m = ts.trim().match(/^(\d+):(\d+):(\d+)(?:\.(\d+))?$/);
	if (!m) return 0;
	const hh = Number(m[1]);
	const mm = Number(m[2]);
	const ss = Number(m[3]);
	const ms = Number((m[4] ?? "0").padEnd(3, "0").slice(0, 3));
	return ((hh * 60 + mm) * 60 + ss) * 1000 + ms;
}

export function parseVttToCues(vtt: string): SubtitleCue[] {
	const lines = vtt.replace(/\r/g, "").split("\n");
	let i = 0;
	// Skip WEBVTT header + possible metadata.
	while (i < lines.length && lines[i].trim() !== "") i++;
	while (i < lines.length && lines[i].trim() === "") i++;

	const cues: SubtitleCue[] = [];
	let cueIndex = 0;
	while (i < lines.length) {
		// Optional cue id line.
		const maybeTiming = lines[i] ?? "";
		if (!maybeTiming.includes("-->")) {
			i++;
			continue;
		}
		const timing = maybeTiming;
		i++;
		const timingMatch = timing.match(/(\d+:\d+:\d+(?:\.\d+)?)\s*-->\s*(\d+:\d+:\d+(?:\.\d+)?)/);
		const startMs = timingMatch ? parseTimestampToMs(timingMatch[1]) : 0;
		const endMs = timingMatch ? parseTimestampToMs(timingMatch[2]) : startMs;

		const textLines: string[] = [];
		while (i < lines.length && lines[i].trim() !== "") {
			textLines.push(lines[i]);
			i++;
		}
		while (i < lines.length && lines[i].trim() === "") i++;

		const rawText = textLines
			.join(" ")
			.replace(/\s+/g, " ")
			.trim();
		const text = cleanCueText(rawText);
		if (!text) continue;
		cues.push({ index: cueIndex++, startMs, endMs, text });
	}
	return cues;
}

function cueTokens(text: string): string[] {
	// Use the same notion of "word" as the verifier.
	return extractWordTokens(text);
}

export function dedupeCuesToWords(cues: SubtitleCue[]): { words: string[]; removed: DuplicateSpan[] } {
	const removed: DuplicateSpan[] = [];
	let out: string[] = [];
	let lastCueText: string | null = null;
	let lastCueTokens: string[] = [];
	let lastCueIndex = -1;

	const appendTokens = (tokens: string[]) => {
		out = out.concat(tokens);
	};

	for (const cue of cues) {
		const text = cue.text;
		if (!text) continue;
		if (lastCueText !== null && text === lastCueText) {
			removed.push({ kind: "adjacent-duplicate", fromCue: lastCueIndex, toCue: cue.index, text });
			continue;
		}

		const tokens = cueTokens(text);
		if (lastCueText !== null && tokens.length > 0 && lastCueTokens.length > 0) {
			// Case A: rolling caption: current starts with previous (replace previous).
			let startsWithPrev = true;
			if (tokens.length >= lastCueTokens.length) {
				for (let k = 0; k < lastCueTokens.length; k++) {
					if (tokens[k] !== lastCueTokens[k]) {
						startsWithPrev = false;
						break;
					}
				}
			} else {
				startsWithPrev = false;
			}

			if (startsWithPrev) {
				// Remove the last cue tokens from output and replace with the longer one.
				out = out.slice(0, Math.max(0, out.length - lastCueTokens.length));
				removed.push({ kind: "rolling-overlap", fromCue: lastCueIndex, toCue: cue.index, text: lastCueTokens.join(" ") });
				appendTokens(tokens);
				lastCueText = text;
				lastCueTokens = tokens;
				lastCueIndex = cue.index;
				continue;
			}

			// Case B: overlap: suffix(prev) == prefix(curr). Remove overlap from curr.
			const maxK = Math.min(lastCueTokens.length, tokens.length);
			let bestK = 0;
			for (let k = maxK; k >= 1; k--) {
				let ok = true;
				for (let j = 0; j < k; j++) {
					if (lastCueTokens[lastCueTokens.length - k + j] !== tokens[j]) {
						ok = false;
						break;
					}
				}
				if (ok) {
					bestK = k;
					break;
				}
			}
			if (bestK > 0) {
				removed.push({ kind: "rolling-overlap", fromCue: lastCueIndex, toCue: cue.index, text: tokens.slice(0, bestK).join(" ") });
				appendTokens(tokens.slice(bestK));
				lastCueText = text;
				lastCueTokens = tokens;
				lastCueIndex = cue.index;
				continue;
			}
		}

		appendTokens(tokens);
		lastCueText = text;
		lastCueTokens = tokens;
		lastCueIndex = cue.index;
	}

	return { words: out, removed };
}

export function extractWordTokens(text: string): string[] {
	// "Words" for verifier purposes. Keep case.
	// Unicode-aware: letters/numbers with optional internal apostrophes.
	const s = String(text ?? "");
	const m = s.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu);
	return m ? m : [];
}

export function proseBodyFromWordsHeuristic(words: string[]): string {
	// Minimal prose: sentences + paragraphs, no word changes.
	// 20 words per sentence, 4 sentences per paragraph.
	const sentenceLen = 20;
	const paraSentences = 4;
	let out = "";
	let w = 0;
	let s = 0;
	for (let i = 0; i < words.length; i++) {
		out += (i === 0 ? "" : " ") + words[i];
		w++;
		if (w >= sentenceLen) {
			out += ".";
			w = 0;
			s++;
			if (s >= paraSentences) {
				out += "\n\n";
				s = 0;
			} else {
				out += " ";
			}
		}
	}
	return out.trim().replace(/\s+\n/g, "\n");
}

export function countParagraphs(text: string): number {
	const parts = text
		.trim()
		.split(/\n\n+/)
		.map((p) => p.trim())
		.filter(Boolean);
	return parts.length;
}

export async function renameDownloadedVttFiles(rawDir: string, basePrefix: string, selected: SelectedSubtitle[]): Promise<string[]> {
	await mkdir(rawDir, { recursive: true });
	const files = await readdir(rawDir);
	const out: string[] = [];

	for (const sel of selected) {
		const lang = sel.language;
		const wantExt = ".vtt";
		// yt-dlp default naming will produce: <basePrefix>.<lang>.vtt
		const candidate = files.find((f) => f.startsWith(`${basePrefix}.${lang}.`) && f.endsWith(wantExt));
		if (!candidate) continue;
		const from = join(rawDir, candidate);
		const toName = `${basePrefix}.${lang}.${sel.kind}.vtt`;
		const to = join(rawDir, toName);
		if (from !== to) {
			await rename(from, to);
		}
		out.push(to);
	}

	return out;
}

export async function writeTranscriptTxt(
	outPath: string,
	head: { videoId: string; lang: string; kind: "manual" | "auto"; url: string },
	body: string,
) {
	await mkdir(dirname(outPath), { recursive: true });
	const header = `yt=${head.videoId} lang=${head.lang} kind=${head.kind} url=${head.url}`;
	const text = `${header}\n---\n${body.trim()}\n`;
	await writeFile(outPath, text, "utf-8");
}

export async function writeAudit(outPath: string, audit: TranscriptAuditV1) {
	await mkdir(dirname(outPath), { recursive: true });
	await writeFile(outPath, JSON.stringify(audit, null, 2) + "\n", "utf-8");
}
