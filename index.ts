import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { downloadVideoBundleTool } from "./src/tool";
import { runDlCommand } from "./src/command";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("dl", {
		description: "Download a YouTube URL into Downloads folder (video+audio+subs+prose). Usage: /dl <url> | /dl doctor",
		handler: async (args, ctx) => runDlCommand(pi, args, ctx),
	});

	pi.registerTool(downloadVideoBundleTool(pi));
}
