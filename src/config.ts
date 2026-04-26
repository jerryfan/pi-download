import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { PiDownloadConfig } from "./types";

export const CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-download.json");

export const DEFAULT_CONFIG: PiDownloadConfig = {
	defaultOutputRoot: null,
	maxHeight: 1080,
	subtitleLanguages: [],
	subtitleMode: "manual-preferred",
	proseTranscript: true,
	overwrite: "reuse",
	inferenceModelMode: "pinned",
	pinnedInferenceModel: "openai-codex/gpt-5.4-mini",
	inferenceThinking: "medium",
	inferenceChunkTimeoutMs: 60_000,
	throttle: {
		sleepIntervalSec: 1,
		maxSleepIntervalSec: 3,
		retries: 3,
		fragmentRetries: 3,
	},
};

export function loadConfig(): PiDownloadConfig {
	try {
		const raw = readFileSync(CONFIG_PATH, "utf-8");
		const parsed = JSON.parse(raw) as Partial<PiDownloadConfig>;
		return {
			...DEFAULT_CONFIG,
			...parsed,
			throttle: { ...DEFAULT_CONFIG.throttle, ...(parsed.throttle ?? {}) },
		};
	} catch {
		return DEFAULT_CONFIG;
	}
}
