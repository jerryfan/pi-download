import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { resolveSystemDownloadsDir } from "./downloads-dir";
import { loadConfig } from "./config";
import { chooseCheapestTextModel } from "./infer";

async function hasBinary(pi: ExtensionAPI, name: string): Promise<{ ok: boolean; version?: string; error?: string }> {
	try {
		const res = await pi.exec(name, ["-version"], { timeout: 5000 });
		if (res.code === 0) return { ok: true, version: (res.stdout || res.stderr).split("\n")[0]?.trim() };
		// yt-dlp uses --version.
		if (name === "yt-dlp") {
			const res2 = await pi.exec(name, ["--version"], { timeout: 5000 });
			if (res2.code === 0) return { ok: true, version: (res2.stdout || res2.stderr).trim() };
			return { ok: false, error: (res2.stderr || res2.stdout || "unknown").trim() };
		}
		return { ok: false, error: (res.stderr || res.stdout || "unknown").trim() };
	} catch (e: any) {
		return { ok: false, error: String(e?.message ?? e) };
	}
}

export async function runDoctor(pi: ExtensionAPI, ctx: ExtensionContext): Promise<string> {
	const cfg = loadConfig();
	const yt = await hasBinary(pi, "yt-dlp");
	const ff = await hasBinary(pi, "ffmpeg");
	const downloads = cfg.defaultOutputRoot || resolveSystemDownloadsDir();
	const pick = chooseCheapestTextModel(ctx, cfg);
	const model = pick.model ? `${pick.model.provider}/${pick.model.id}` : "(none)";

	return [
		`yt-dlp: ${yt.ok ? `ok (${yt.version ?? ""})` : `missing (${yt.error ?? ""})`}`.trim(),
		`ffmpeg: ${ff.ok ? `ok (${ff.version ?? ""})` : `missing (${ff.error ?? ""})`}`.trim(),
		`downloads: ${downloads}`,
		`inference: ${cfg.inferenceModelMode} ${cfg.inferenceModelMode === "off" ? "" : `(${model})`}`.trim(),
	].join("\n");
}
