import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { runDoctor } from "./doctor";
import { runDl } from "./pipeline";
import { loadConfig } from "./config";
import { entryToWatchUrl, ytListEntries } from "./yt";

function isUrlLike(s: string): boolean {
	const v = s.trim();
	return v.startsWith("http://") || v.startsWith("https://") || v.startsWith("youtu.be/") || v.includes("youtube.com/");
}

export async function runDlCommand(pi: ExtensionAPI, args: string, ctx: ExtensionContext): Promise<void> {
	const a = (args ?? "").trim();
	if (!a) {
		ctx.ui.notify("Usage: /dl <url> | /dl doctor", "info");
		return;
	}

	if (a === "doctor") {
		const report = await runDoctor(pi, ctx);
		ctx.ui.notify(report, "info");
		return;
	}

	const url = normalizeUrl(a);
	if (!isUrlLike(url)) {
		ctx.ui.notify("/dl expects a URL", "error");
		return;
	}

	try {
		const manifest = await runDl(pi, ctx, { url }, ctx.signal);
		const lines = [
			"dl done",
			`out: ${manifest.request.outDir}`,
			manifest.outputs.videoPath ? `video: ${manifest.outputs.videoPath}` : "video: (missing)",
			manifest.outputs.audioPath ? `audio: ${manifest.outputs.audioPath}` : "audio: (missing)",
			manifest.outputs.proseTranscriptPaths[0] ? `txt: ${manifest.outputs.proseTranscriptPaths[0]}` : "txt: (none)",
			`manifest: ${manifest.outputs.manifestPath}`,
			manifest.outputs.debugPath ? `debug: ${manifest.outputs.debugPath}` : "debug: (none)",
		];
		ctx.ui.notify(lines.join("\n"), "info");
	} catch (e: any) {
		ctx.ui.setStatus("dl", "dl: error");
		ctx.ui.notify(String(e?.message ?? e), "error");
	}
}

export async function runSubsCommand(pi: ExtensionAPI, args: string, ctx: ExtensionContext): Promise<void> {
	const a = (args ?? "").trim();
	if (!a) {
		ctx.ui.notify("Usage: /subs <url>", "info");
		return;
	}

	const parts = a.split(/\s+/);
	const url = normalizeUrl(parts[0] ?? "");
	const interest = parts.slice(1).join(" ").trim();
	if (!isUrlLike(url)) {
		ctx.ui.notify("/subs expects a URL", "error");
		return;
	}

	try {
		const cfg = loadConfig();
		const listUrl = /youtube\.com\/@[^/?#]+\/?(?:[?#].*)?$/i.test(url) ? url.replace(/\/?(?:[?#].*)?$/, "/videos") : url;
		const entries = await ytListEntries(pi, listUrl, cfg, ctx.signal);
		const interestTerms = interest.toLowerCase().split(/\s+/).filter(Boolean);
		const scoredEntries = entries
			.map((entry) => {
				const title = (entry.title ?? "").toLowerCase();
				const score = interestTerms.length ? interestTerms.reduce((n, term) => n + (title.includes(term) ? 1 : 0), 0) : 0;
				return { entry, score };
			})
			.filter((x) => !interestTerms.length || x.score > 0)
			.sort((a, b) => b.score - a.score);
		const selectedEntries = (scoredEntries.length ? scoredEntries.map((x) => x.entry) : entries).slice(0, 10);
		const videoUrls = [...new Set(selectedEntries.map(entryToWatchUrl).filter((v): v is string => !!v))];

		if (videoUrls.length > 1 || /youtube\.com\/@|\/channel\/|\/playlist\?|\/videos\b/i.test(url)) {
			const manifests = [];
			for (let i = 0; i < videoUrls.length; i++) {
				if (ctx.hasUI) ctx.ui.setStatus("dl", `subs: ${i + 1}/${videoUrls.length}`);
				manifests.push(await runDl(pi, ctx, { url: videoUrls[i], media: "subs-only", proseTranscript: true, minimalFiles: true }, ctx.signal));
			}
			ctx.ui.notify(["subs collection done", `items: ${manifests.length}`, interest ? `interest: ${interest}` : "interest: latest", "limit: 10", manifests[0] ? `first out: ${manifests[0].request.outDir}` : "out: (none)"].join("\n"), "info");
			return;
		}

		const manifest = await runDl(pi, ctx, { url: videoUrls[0] ?? url, media: "subs-only", proseTranscript: true, minimalFiles: true }, ctx.signal);
		const lines = [
			"subs done",
			`out: ${manifest.request.outDir}`,
			manifest.outputs.proseTranscriptPaths[0] ? `txt: ${manifest.outputs.proseTranscriptPaths[0]}` : "txt: (none)",
			`manifest: ${manifest.outputs.manifestPath}`,
		];
		ctx.ui.notify(lines.join("\n"), "info");
	} catch (e: any) {
		ctx.ui.setStatus("dl", "subs: error");
		ctx.ui.notify(String(e?.message ?? e), "error");
	}
}

function normalizeUrl(input: string): string {
	const v = input.trim();
	if (v.startsWith("http://") || v.startsWith("https://")) return v;
	if (v.startsWith("youtu.be/")) return `https://${v}`;
	if (v.startsWith("www.youtube.com/")) return `https://${v}`;
	if (v.startsWith("youtube.com/")) return `https://${v}`;
	return v;
}
