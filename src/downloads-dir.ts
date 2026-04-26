import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

function stripQuotes(s: string): string {
	const v = s.trim();
	if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
	return v;
}

export function resolveSystemDownloadsDir(): string {
	const home = homedir();
	if (process.platform === "win32") {
		const userProfile = process.env.USERPROFILE || home;
		return join(userProfile, "Downloads");
	}

	if (process.platform === "darwin") return join(home, "Downloads");

	// Linux / other: try XDG user dirs.
	try {
		const userDirs = join(home, ".config", "user-dirs.dirs");
		const text = readFileSync(userDirs, "utf-8");
		const m = text.match(/^XDG_DOWNLOAD_DIR=(.+)$/m);
		if (m?.[1]) {
			const raw = stripQuotes(m[1]);
			const expanded = raw.replace("$HOME", home);
			return expanded.startsWith("/") ? expanded : join(home, expanded);
		}
	} catch {
		// ignore
	}

	return join(home, "Downloads");
}
