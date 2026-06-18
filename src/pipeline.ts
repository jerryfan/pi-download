import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { appendFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveSystemDownloadsDir } from "./downloads-dir";
import { loadConfig } from "./config";
import type { ManifestV1, PiDownloadConfig, SelectedSubtitle, TranscriptAuditV1 } from "./types";
import { inferProseFormatting, inferShortLabel } from "./infer";
import { buildVideoReferenceMetadata, renderBibliography, renderVideoReferenceBlock } from "./metadata";
import { slugifyLabel } from "./slug";
import { ytDownloadAudio, ytDownloadMergedVideo, ytDownloadSubtitles, ytInspect } from "./yt";
import {
	countParagraphs,
	dedupeCuesToWords,
	extractWordTokens,
	parseVttToCues,
	proseBodyFromWordsHeuristic,
	renameDownloadedVttFiles,
	writeAudit,
	writeTranscriptTxt,
} from "./subtitles";

function requireString(v: unknown, name: string): string {
	if (typeof v !== "string" || !v.trim()) throw new Error(`${name} is required`);
	return v.trim();
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function findDownloadedFile(dir: string, prefix: string, suffix: string): Promise<string | null> {
	try {
		const files = await readdir(dir);
		const hit = files.find((f) => f.startsWith(prefix) && f.endsWith(suffix));
		return hit ? join(dir, hit) : null;
	} catch {
		return null;
	}
}

function pickSubtitleLanguages(info: any, cfg: PiDownloadConfig, explicit: string[]): string[] {
	const allManual = Object.keys(info.subtitles ?? {});
	const allAuto = Object.keys(info.automatic_captions ?? {});
	const pool = allManual.length ? allManual : allAuto;
	if (explicit.length) return explicit;
	if (cfg.subtitleLanguages.length) return cfg.subtitleLanguages;
	if (pool.includes("en")) return ["en"];
	return pool.length ? [pool[0] as string] : [];
}

function pickKindForLang(info: any, cfg: PiDownloadConfig, lang: string): "manual" | "auto" | null {
	const hasManual = Boolean((info.subtitles ?? {})[lang]);
	const hasAuto = Boolean((info.automatic_captions ?? {})[lang]);
	if (cfg.subtitleMode === "manual-only") return hasManual ? "manual" : null;
	if (cfg.subtitleMode === "auto-ok") return hasManual ? "manual" : hasAuto ? "auto" : null;
	// manual-preferred
	return hasManual ? "manual" : hasAuto ? "auto" : null;
}

function verifyWordFidelity(expectedWords: string[], body: string): { ok: boolean; reason?: string } {
	const got = extractWordTokens(body);
	if (got.length !== expectedWords.length) {
		return { ok: false, reason: `word count mismatch: expected ${expectedWords.length}, got ${got.length}` };
	}
	for (let i = 0; i < expectedWords.length; i++) {
		if (got[i] !== expectedWords[i]) return { ok: false, reason: `word mismatch at ${i}: expected "${expectedWords[i]}", got "${got[i]}"` };
	}
	return { ok: true };
}

function ensureSentencePunctuation(body: string, words: string[]): string {
	// If it already has sentence terminators, keep.
	if (/[.!?]/.test(body)) return body;
	return proseBodyFromWordsHeuristic(words);
}

export async function runDl(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	input: {
		url: string;
		outDir?: string;
		maxHeight?: number;
		subtitleLanguages?: string[];
		subtitleMode?: "manual-preferred" | "manual-only" | "auto-ok";
		proseTranscript?: boolean;
		overwrite?: "reuse" | "replace";
		media?: "all" | "subs-only";
		minimalFiles?: boolean;
	},
	signal?: AbortSignal,
): Promise<ManifestV1> {
	const startedAt = Date.now();
	const url = requireString(input.url, "url");
	const cfg0 = loadConfig();
	const cfg: PiDownloadConfig = {
		...cfg0,
		maxHeight: input.maxHeight ?? cfg0.maxHeight,
		subtitleMode: input.subtitleMode ?? cfg0.subtitleMode,
		proseTranscript: input.proseTranscript ?? cfg0.proseTranscript,
		overwrite: input.overwrite ?? cfg0.overwrite,
	};

	const outputRoot = input.outDir?.trim() || cfg.defaultOutputRoot || resolveSystemDownloadsDir();

	// Debug logging (best-effort, never throws)
	let debugPath: string | undefined;
	let dbgChain: Promise<void> = Promise.resolve();
	const dbg = (msg: string) => {
		if (!debugPath) return;
		const line = `[${new Date().toISOString()}] ${msg.replace(/\r/g, "").trimEnd()}\n`;
		dbgChain = dbgChain
			.then(async () => {
				await appendFile(debugPath!, line, "utf-8");
			})
			.catch(() => {
				// swallow
			});
	};
	const dbgFlush = async () => {
		try {
			await dbgChain;
		} catch {
			// swallow
		}
	};

	try {
		if (ctx.hasUI) ctx.ui.setStatus("dl", "dl: inspect");
		const info = await ytInspect(pi, url, cfg, signal);
		const videoId = info.id;
		const title = info.title ?? "";

		const label = title
			? await inferShortLabel(ctx, cfg, title, signal ?? new AbortController().signal)
			: slugifyLabel(videoId);

		const baseFolder = `${label}-yt-${videoId}`;
		let outDir = join(outputRoot, baseFolder);
		if (cfg.overwrite === "reuse") {
			// If folder exists but is for another videoId, suffix.
			let n = 2;
			while (await exists(outDir)) {
				// best-effort: if it already contains this video id, reuse.
				if (outDir.endsWith(`-yt-${videoId}`)) break;
				outDir = join(outputRoot, `${baseFolder}-${n++}`);
			}
		}
		await mkdir(outDir, { recursive: true });

		debugPath = join(outDir, "DEBUG.txt");
		dbg("====================");
		dbg(`run start (ms=${startedAt})`);
		dbg(`url: ${url}`);
		dbg(`outputRoot: ${outputRoot}`);
		dbg(`outDir: ${outDir}`);
		dbg(`videoId: ${videoId}`);
		dbg(`title: ${title}`);
		dbg(`label: ${label}`);
		dbg(`cfg: maxHeight=${cfg.maxHeight}, subtitleMode=${cfg.subtitleMode}, proseTranscript=${cfg.proseTranscript}, overwrite=${cfg.overwrite}`);

		signal?.addEventListener("abort", () => dbg("ABORT signal received"), { once: true });

		const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
			dbg(`>> ${name}`);
			const t0 = Date.now();
			try {
				const r = await fn();
				dbg(`<< ${name} ok (${Date.now() - t0}ms)`);
				return r;
			} catch (e: any) {
				dbg(`<< ${name} ERROR (${Date.now() - t0}ms): ${String(e?.stack ?? e?.message ?? e)}`);
				throw e;
			}
		};

		// Single-folder layout (no nested dirs)
		const mediaDir = outDir;
		const rawSubsDir = outDir;
		const proseDir = outDir;

		const basePrefix = `${label}-yt-${videoId}`;
		const videoBase = join(mediaDir, `${basePrefix}.video`);
		const audioBase = join(mediaDir, `${basePrefix}.audio`);
		const subsBase = join(rawSubsDir, `${basePrefix}`);

		const mediaMode = input.media ?? "all";
		const minimalFiles = input.minimalFiles ?? false;

		if (mediaMode !== "subs-only") {
			if (ctx.hasUI) ctx.ui.setStatus("dl", "dl: video");
			await step("yt-dlp video", () => ytDownloadMergedVideo(pi, url, videoBase, cfg, signal));

			if (ctx.hasUI) ctx.ui.setStatus("dl", "dl: audio");
			await step("yt-dlp audio", () => ytDownloadAudio(pi, url, audioBase, cfg, signal));
		} else {
			dbg("subs-only mode: skipping video and audio downloads");
		}

		const subtitleLangs = pickSubtitleLanguages(info, cfg, input.subtitleLanguages ?? []);
		dbg(`subtitleLangs: ${subtitleLangs.join(",") || "(none)"}`);
		const selected: SelectedSubtitle[] = [];
		for (const lang of subtitleLangs) {
			const kind = pickKindForLang(info, cfg, lang);
			if (!kind) continue;
			selected.push({ language: lang, kind, format: "vtt" });
		}
		dbg(`selected subtitles: ${selected.map((s) => `${s.language}:${s.kind}`).join(",") || "(none)"}`);

		let rawSubtitlePaths: string[] = [];
		let proseTranscriptPaths: string[] = [];
		let auditPaths: string[] = [];
		let cleanupMode: ManifestV1["cleanup"]["mode"] = "heuristic";
		let verifierPassed = false;
		let modelUsed: string | undefined;
		let removedSpansCount = 0;
		let videoReference = buildVideoReferenceMetadata(info, url);

		if (selected.length > 0) {
			if (ctx.hasUI) ctx.ui.setStatus("dl", "dl: subtitles");
			const manualLangs = selected.filter((s) => s.kind === "manual").map((s) => s.language);
			const autoLangs = selected.filter((s) => s.kind === "auto").map((s) => s.language);
			if (manualLangs.length) await step(`yt-dlp subs manual (${manualLangs.join(",")})`, () => ytDownloadSubtitles(pi, url, subsBase, cfg, "manual", manualLangs, signal));
			if (autoLangs.length) await step(`yt-dlp subs auto (${autoLangs.join(",")})`, () => ytDownloadSubtitles(pi, url, subsBase, cfg, "auto", autoLangs, signal));
			rawSubtitlePaths = await step("rename vtt", () => renameDownloadedVttFiles(rawSubsDir, basePrefix, selected));
			dbg(`rawSubtitlePaths: ${rawSubtitlePaths.length}`);

			if (cfg.proseTranscript) {
				if (ctx.hasUI) ctx.ui.setStatus("dl", "dl: prose");
				for (const sub of selected) {
					const outTxt = join(proseDir, `${basePrefix}.${sub.language}.txt`);
					const outAudit = join(proseDir, `${basePrefix}.${sub.language}.audit.json`);
					try {
						const vttPath = join(rawSubsDir, `${basePrefix}.${sub.language}.${sub.kind}.vtt`);
						dbg(`prose input vtt: ${vttPath}`);
						if (!(await exists(vttPath))) {
							dbg(`missing vtt: ${vttPath}`);
							continue;
						}
						const vtt = await readFile(vttPath, "utf-8");
						dbg(`vtt bytes: ${Buffer.byteLength(vtt, "utf-8")}`);
						const cues = parseVttToCues(vtt);
						const deduped = dedupeCuesToWords(cues);
						removedSpansCount += deduped.removed.length;
						// dedupeCuesToWords returns verifier-grade word tokens already.
						const expectedWords = deduped.words;
						videoReference = buildVideoReferenceMetadata(info, url, expectedWords);
						dbg(`cues=${cues.length}, expectedWords=${expectedWords.length}, removedSpans=${deduped.removed.length}`);

						// Chunked VTT->TXT conversion (resilient): process in small word chunks,
						// write output incrementally so one failed chunk doesn't kill the whole transcript.
						const pie = (pct: number): string => (pct >= 100 ? "●" : pct >= 75 ? "◕" : pct >= 50 ? "◑" : pct >= 25 ? "◔" : "○");
						const chunkSizeWords = 1200;
						const totalChunks = Math.max(1, Math.ceil(expectedWords.length / chunkSizeWords));
						let allChunksVerified = true;
						let usedAnyLlm = false;
						let paragraphCount = 0;

						const audit: TranscriptAuditV1 = {
							version: 1,
							sourceLanguage: sub.language,
							mode: "heuristic",
							verifierPassed: false,
							removedDuplicateSpans: deduped.removed,
							stats: {
								rawCueCount: cues.length,
								rawWordCount: expectedWords.length,
								outputWordCount: 0,
								paragraphCount: 0,
							},
						};

						await step(`write transcript reference (${sub.language})`, async () => {
							await writeFile(outTxt, renderVideoReferenceBlock(videoReference), "utf-8");
						});

						for (let ci = 0; ci < totalChunks; ci++) {
							const start = ci * chunkSizeWords;
							const chunkWords = expectedWords.slice(start, start + chunkSizeWords);
							const pct = Math.floor(((ci + 1) / totalChunks) * 100);
							if (ctx.hasUI) ctx.ui.setStatus("dl", `${pie(pct)} ${pct}% dl: prose ${sub.language} (${ci + 1}/${totalChunks})`);
							dbg(`prose chunk ${ci + 1}/${totalChunks}: words=${chunkWords.length}`);

							let piece = "";
							let inferredOk = false;
							let inferredModel: string | undefined;

							// Per-chunk timeout to avoid indefinite hangs.
							const ac = new AbortController();
							const t = setTimeout(() => ac.abort(), Math.max(5_000, cfg.inferenceChunkTimeoutMs));
							const chunkSignal = signal
								? (AbortSignal as any).any
									? (AbortSignal as any).any([signal, ac.signal])
									: ac.signal
								: ac.signal;
							try {
								const inferred = await inferProseFormatting(ctx, cfg, chunkWords, chunkSignal);
								inferredOk = inferred.ok;
								inferredModel = inferred.model;
								piece = inferred.ok ? inferred.body : "";
							} catch (e: any) {
								dbg(`infer prose chunk ${ci + 1} error: ${String(e?.stack ?? e?.message ?? e)}`);
								inferredOk = false;
								piece = "";
							} finally {
								clearTimeout(t);
							}

							if (inferredOk) {
								usedAnyLlm = true;
								cleanupMode = "llm-assisted";
								audit.mode = "llm-assisted";
								modelUsed = inferredModel;
							} else {
								piece = proseBodyFromWordsHeuristic(chunkWords);
							}

							piece = ensureSentencePunctuation(piece, chunkWords);
							const v = verifyWordFidelity(chunkWords, piece);
							if (!v.ok) {
								allChunksVerified = false;
								dbg(`verifier failed (chunk ${ci + 1}/${totalChunks}): ${v.reason ?? "(no reason)"}`);
								// Fallback heuristic for just this chunk.
								piece = proseBodyFromWordsHeuristic(chunkWords);
								piece = ensureSentencePunctuation(piece, chunkWords);
							}

							paragraphCount += countParagraphs(piece);
							await appendFile(outTxt, piece.trim() + "\n\n", "utf-8");
						}

						audit.stats.outputWordCount = expectedWords.length;
						audit.stats.paragraphCount = paragraphCount;
						audit.verifierPassed = allChunksVerified;
						verifierPassed = allChunksVerified;
						if (!allChunksVerified && usedAnyLlm) {
							cleanupMode = "fallback-heuristic";
							audit.mode = "fallback-heuristic";
							audit.failureReason = "verifier failed for at least one chunk";
						}

						await appendFile(outTxt, renderBibliography(videoReference), "utf-8");

						await step(`write audit (${sub.language})`, async () => {
							await writeAudit(outAudit, audit);
						});

						proseTranscriptPaths.push(outTxt);
						auditPaths.push(outAudit);
					} catch (e: any) {
						// Prose generation should be best-effort; failure must not kill the whole download.
						dbg(`prose (${sub.language}) ERROR: ${String(e?.stack ?? e?.message ?? e)}`);
						const audit: TranscriptAuditV1 = {
							version: 1,
							sourceLanguage: sub.language,
							mode: "fallback-heuristic",
							verifierPassed: false,
							removedDuplicateSpans: [],
							stats: { rawCueCount: 0, rawWordCount: 0, outputWordCount: 0, paragraphCount: 0 },
							failureReason: String(e?.message ?? e),
						};
						await step(`write transcript reference (${sub.language})`, async () => {
							await writeFile(outTxt, renderVideoReferenceBlock(videoReference), "utf-8");
						});
						await step(`write audit (${sub.language})`, async () => {
							await writeAudit(outAudit, audit);
						});
						proseTranscriptPaths.push(outTxt);
						auditPaths.push(outAudit);
					}
				}
			}
		}

		if (minimalFiles) {
			for (const p of [...rawSubtitlePaths, ...auditPaths]) {
				await step(`remove intermediate ${p}`, async () => {
					await rm(p, { force: true });
				});
			}
			rawSubtitlePaths = [];
			auditPaths = [];
		}

		const manifestPath = join(outDir, "manifest.json");
		const videoPath = mediaMode === "subs-only" ? undefined : await findDownloadedFile(mediaDir, `${basePrefix}.video.`, "");
		const audioPath = mediaMode === "subs-only" ? undefined : await findDownloadedFile(mediaDir, `${basePrefix}.audio.`, "");

		const manifest: ManifestV1 = {
			version: 1,
			extension: { name: "pi-download", version: "0.1.0" },
			source: {
				provider: "youtube",
				url: videoReference.url,
				videoId,
				title: info.title,
				channel: videoReference.channelName ?? info.uploader,
				channelUrl: videoReference.channelUrl,
				uploader: videoReference.uploader,
				uploaderUrl: videoReference.uploaderUrl,
				uploadDate: videoReference.uploadDate,
				durationSec: info.duration,
				description: videoReference.description,
				tags: videoReference.tags,
				chapters: videoReference.chapters,
			},
			participants: videoReference.participants,
			referencedPeople: videoReference.referencedPeople,
			request: {
				outDir,
				maxHeight: cfg.maxHeight,
				subtitleLanguages: subtitleLangs,
				subtitleMode: cfg.subtitleMode,
				proseTranscript: cfg.proseTranscript,
				overwrite: cfg.overwrite,
			},
			selectedFormats: {
				// Filled best-effort from yt-dlp JSON.
				subtitles: selected.map((s) => ({ language: s.language, kind: s.kind, ext: "vtt" })),
			},
			outputs: {
				videoPath: videoPath ?? undefined,
				audioPath: audioPath ?? undefined,
				rawSubtitlePaths,
				proseTranscriptPaths,
				auditPaths,
				manifestPath,
				debugPath,
			},
			cleanup: {
				mode: cleanupMode,
				model: modelUsed,
				verifierPassed,
				duplicateSpanCount: removedSpansCount,
			},
		};

		await step("write manifest", () => writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8"));
		dbg(`run complete in ${Date.now() - startedAt}ms (total since fn start ${Date.now() - startedAt}ms)`);
		dbg(`debugPath: ${debugPath}`);
		await dbgFlush();

		if (ctx.hasUI) ctx.ui.setStatus("dl", "dl: done");
		return manifest;
	} catch (e: any) {
		dbg(`FATAL: ${String(e?.stack ?? e?.message ?? e)}`);
		await dbgFlush();
		throw e;
	} finally {
		if (ctx.hasUI && signal?.aborted) ctx.ui.setStatus("dl", "dl: aborted");
	}
}
