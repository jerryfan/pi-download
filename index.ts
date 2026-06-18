import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { downloadVideoBundleTool } from "./src/tool";
import { runDlCommand, runSubsCommand } from "./src/command";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("dl", {
		description: "Download a YouTube URL into Downloads folder (video+audio+subs+prose). Usage: /dl <url> | /dl doctor",
		handler: async (args, ctx) => runDlCommand(pi, args, ctx),
	});

	pi.registerCommand("subs", {
		description: "Download only YouTube subtitles and generate best prose .txt with minimal files. Usage: /subs <url>",
		handler: async (args, ctx) => runSubsCommand(pi, args, ctx),
	});

	pi.registerTool(downloadVideoBundleTool(pi));
}
