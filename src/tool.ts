import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { runDl } from "./pipeline";

export function downloadVideoBundleTool(_pi: ExtensionAPI) {
	return {
		name: "download_video_bundle",
		label: "download_video_bundle",
		description: "Download a YouTube URL into the system Downloads folder (video+audio+subs+prose .txt).",
		parameters: Type.Object({
			url: Type.String({ description: "YouTube URL" }),
			outDir: Type.Optional(Type.String({ description: "Override output directory (default: system Downloads folder)" })),
			maxHeight: Type.Optional(Type.Number({ description: "Max video height (default: 1080)" })),
			subtitleLanguages: Type.Optional(Type.Array(Type.String(), { description: "Subtitle language codes" })),
			subtitleMode: Type.Optional(StringEnum(["manual-preferred", "manual-only", "auto-ok"] as const)),
			proseTranscript: Type.Optional(Type.Boolean({ description: "Generate prose transcript .txt (default true)" })),
			overwrite: Type.Optional(StringEnum(["reuse", "replace"] as const)),
		}),
		promptSnippet: "Download a YouTube URL into Downloads folder and generate a prose subtitle .txt without changing words.",
		promptGuidelines: [
			"Use download_video_bundle for YouTube downloads instead of hand-writing yt-dlp commands.",
			"The prose transcript must keep the exact same words as the subtitles (no paraphrase), only formatting/punctuation/paragraphing is allowed.",
		],
		async execute(_toolCallId: string, params: any, signal: AbortSignal, _onUpdate: any, ctx: any) {
			const manifest = await runDl(_pi, ctx, params, signal);
			return {
				content: [
					{
						type: "text",
						text:
							`out: ${manifest.request.outDir}\n` +
							`video: ${manifest.outputs.videoPath ?? "(missing)"}\n` +
							`audio: ${manifest.outputs.audioPath ?? "(missing)"}\n` +
							`subs: ${manifest.outputs.rawSubtitlePaths.length}\n` +
							`txt: ${manifest.outputs.proseTranscriptPaths[0] ?? "(none)"}\n` +
							`manifest: ${manifest.outputs.manifestPath}\n` +
							`debug: ${manifest.outputs.debugPath ?? "(none)"}`,
					},
				],
				details: manifest,
			};
		},
	} as const;
}
