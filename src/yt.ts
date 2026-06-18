import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { PiDownloadConfig } from "./types";

export type YtPlaylistEntry = { id?: string; url?: string; title?: string; webpage_url?: string; _type?: string };

export type YtPlaylistInfo = { id?: string; title?: string; webpage_url?: string; entries?: YtPlaylistEntry[] };

export type YtInfo = {
	id: string;
	title?: string;
	uploader?: string;
	uploader_url?: string;
	channel?: string;
	channel_url?: string;
	webpage_url?: string;
	upload_date?: string;
	description?: string;
	tags?: string[];
	chapters?: Array<{ start_time?: number; end_time?: number; title?: string }>;
	duration?: number;
	subtitles?: Record<string, Array<{ ext: string }>>;
	automatic_captions?: Record<string, Array<{ ext: string }>>;
	formats?: Array<{ format_id?: string; ext?: string; height?: number; abr?: number; vcodec?: string; acodec?: string }>;
};

export async function ytListEntries(pi: ExtensionAPI, url: string, cfg: PiDownloadConfig, signal?: AbortSignal): Promise<YtPlaylistEntry[]> {
	const args = [
		"--flat-playlist",
		"--dump-single-json",
		"--skip-download",
		"--no-warnings",
		`--sleep-interval=${cfg.throttle.sleepIntervalSec}`,
		`--max-sleep-interval=${cfg.throttle.maxSleepIntervalSec}`,
		`--retries=${cfg.throttle.retries}`,
		`--fragment-retries=${cfg.throttle.fragmentRetries}`,
		url,
	];
	const res = await pi.exec("yt-dlp", args, { signal, timeout: 5 * 60_000 });
	if (res.code !== 0) throw new Error((res.stderr || res.stdout || "yt-dlp list failed").trim());
	const parsed = JSON.parse(res.stdout) as YtPlaylistInfo | YtPlaylistEntry;
	const entries = Array.isArray((parsed as YtPlaylistInfo).entries) ? (parsed as YtPlaylistInfo).entries! : [parsed as YtPlaylistEntry];
	return entries.filter((e) => e?.id || e?.url || e?.webpage_url);
}

export function entryToWatchUrl(entry: YtPlaylistEntry): string | null {
	if (entry.webpage_url?.startsWith("http")) return entry.webpage_url;
	const v = entry.id || entry.url;
	if (!v) return null;
	if (v.startsWith("http")) return v;
	return `https://www.youtube.com/watch?v=${v}`;
}

export async function ytInspect(pi: ExtensionAPI, url: string, cfg: PiDownloadConfig, signal?: AbortSignal): Promise<YtInfo> {
	const args = [
		"--no-playlist",
		"--no-warnings",
		"--dump-single-json",
		"--skip-download",
		`--sleep-interval=${cfg.throttle.sleepIntervalSec}`,
		`--max-sleep-interval=${cfg.throttle.maxSleepIntervalSec}`,
		`--retries=${cfg.throttle.retries}`,
		`--fragment-retries=${cfg.throttle.fragmentRetries}`,
		url,
	];
	const res = await pi.exec("yt-dlp", args, { signal, timeout: 60_000 });
	if (res.code !== 0) throw new Error((res.stderr || res.stdout || "yt-dlp inspect failed").trim());
	try {
		return JSON.parse(res.stdout) as YtInfo;
	} catch {
		throw new Error("yt-dlp returned invalid JSON");
	}
}

export async function ytDownloadMergedVideo(pi: ExtensionAPI, url: string, outPathNoExt: string, cfg: PiDownloadConfig, signal?: AbortSignal) {
	const format = `bestvideo[height<=${cfg.maxHeight}]+bestaudio/best[height<=${cfg.maxHeight}]`;
	const args = [
		"--no-playlist",
		"--no-warnings",
		`--sleep-interval=${cfg.throttle.sleepIntervalSec}`,
		`--max-sleep-interval=${cfg.throttle.maxSleepIntervalSec}`,
		`--retries=${cfg.throttle.retries}`,
		`--fragment-retries=${cfg.throttle.fragmentRetries}`,
		"--concurrent-fragments",
		"1",
		"-f",
		format,
		"--merge-output-format",
		"mp4",
		"-o",
		`${outPathNoExt}.%(ext)s`,
		url,
	];
	const res = await pi.exec("yt-dlp", args, { signal, timeout: 60 * 60_000 });
	if (res.code !== 0) throw new Error((res.stderr || res.stdout || "yt-dlp video download failed").trim());
}

export async function ytDownloadAudio(pi: ExtensionAPI, url: string, outPathNoExt: string, cfg: PiDownloadConfig, signal?: AbortSignal) {
	const args = [
		"--no-playlist",
		"--no-warnings",
		`--sleep-interval=${cfg.throttle.sleepIntervalSec}`,
		`--max-sleep-interval=${cfg.throttle.maxSleepIntervalSec}`,
		`--retries=${cfg.throttle.retries}`,
		`--fragment-retries=${cfg.throttle.fragmentRetries}`,
		"--concurrent-fragments",
		"1",
		"-f",
		"bestaudio",
		"-x",
		"--audio-format",
		"m4a",
		"-o",
		`${outPathNoExt}.%(ext)s`,
		url,
	];
	const res = await pi.exec("yt-dlp", args, { signal, timeout: 60 * 60_000 });
	if (res.code !== 0) throw new Error((res.stderr || res.stdout || "yt-dlp audio download failed").trim());
}

export async function ytDownloadSubtitles(
	pi: ExtensionAPI,
	url: string,
	outTemplateNoExt: string,
	cfg: PiDownloadConfig,
	kind: "manual" | "auto",
	langs: string[],
	signal?: AbortSignal,
) {
	const args = [
		"--no-playlist",
		"--no-warnings",
		`--sleep-interval=${cfg.throttle.sleepIntervalSec}`,
		`--max-sleep-interval=${cfg.throttle.maxSleepIntervalSec}`,
		`--retries=${cfg.throttle.retries}`,
		`--fragment-retries=${cfg.throttle.fragmentRetries}`,
		"--skip-download",
		"--sub-format",
		"vtt",
		"--sub-langs",
		langs.join(","),
		kind === "manual" ? "--write-subs" : "--write-auto-subs",
		"-o",
		`${outTemplateNoExt}.%(ext)s`,
		url,
	];
	const res = await pi.exec("yt-dlp", args, { signal, timeout: 20 * 60_000 });
	if (res.code !== 0) throw new Error((res.stderr || res.stdout || "yt-dlp subtitle download failed").trim());
}
