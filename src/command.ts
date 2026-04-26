import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { runDoctor } from "./doctor";
import { runDl } from "./pipeline";

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

function normalizeUrl(input: string): string {
	const v = input.trim();
	if (v.startsWith("http://") || v.startsWith("https://")) return v;
	if (v.startsWith("youtu.be/")) return `https://${v}`;
	if (v.startsWith("www.youtube.com/")) return `https://${v}`;
	if (v.startsWith("youtube.com/")) return `https://${v}`;
	return v;
}
