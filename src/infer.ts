import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { completeSimple, type Api, type Model, type UserMessage } from "@mariozechner/pi-ai";
import type { ModelPick, ModelRef, PiDownloadConfig } from "./types";
import { isValidLabel, slugifyLabel } from "./slug";

function parseModelRef(ref: string): ModelRef | null {
	const v = ref.trim();
	const slash = v.indexOf("/");
	if (slash <= 0 || slash >= v.length - 1) return null;
	return { provider: v.slice(0, slash), id: v.slice(slash + 1) };
}

function modelScore(model: Model<Api>): number {
	const c = model.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	return c.input * 1.0 + c.output * 1.2;
}

export function chooseCheapestTextModel(ctx: ExtensionContext, cfg: PiDownloadConfig): ModelPick {
	const available = (ctx.modelRegistry.getAvailable() as Model<Api>[]).filter((m) => m.input.includes("text"));
	if (available.length === 0) return { model: null, reason: "no available text models" };

	if (cfg.inferenceModelMode === "pinned" && cfg.pinnedInferenceModel) {
		const parsed = parseModelRef(cfg.pinnedInferenceModel);
		if (parsed) {
			const pinned = available.find((m) => m.provider === parsed.provider && m.id === parsed.id);
			if (pinned) return { model: pinned, reason: "pinned" };
		}
	}

	const nonSpark = available.filter((m) => !String(m.id).includes("spark"));
	const pool = nonSpark.length ? nonSpark : available;
	const sorted = [...pool].sort((a, b) => modelScore(a) - modelScore(b));
	return { model: sorted[0] ?? null, reason: nonSpark.length ? "auto cheapest (non-spark)" : "auto cheapest fallback" };
}

function extractText(content: Array<{ type: string; text?: string }>): string {
	return content
		.filter((c) => c.type === "text" && typeof c.text === "string")
		.map((c) => c.text as string)
		.join("\n");
}

function parseStrictJson<T>(raw: string): T | null {
	const source = String(raw ?? "").trim();
	if (!source) return null;
	try {
		return JSON.parse(source) as T;
	} catch {
		// try extract first json object
		const m = source.match(/\{[\s\S]*\}/);
		if (!m?.[0]) return null;
		try {
			return JSON.parse(m[0]) as T;
		} catch {
			return null;
		}
	}
}

export async function inferShortLabel(ctx: ExtensionContext, cfg: PiDownloadConfig, title: string, signal: AbortSignal): Promise<string> {
	const fallback = slugifyLabel(title);
	if (cfg.inferenceModelMode === "off") return fallback;

	const picked = chooseCheapestTextModel(ctx, cfg);
	if (!picked.model) return fallback;

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(picked.model);
	if (!auth.ok || !auth.apiKey) return fallback;

	const user: UserMessage = {
		role: "user",
		content: [
			{
				type: "text",
				text:
					"Return STRICT JSON only: {\"label\": string}. " +
					"label must match ^[a-z0-9-]{1,32}$. " +
					"Derive it from the title. No extra keys.\n\n" +
					`TITLE:\n${title}`,
			},
		],
		timestamp: Date.now(),
	};

	const systemPrompt = "You produce safe short filesystem labels. Output JSON only.";
	const resp = await completeSimple(
		picked.model,
		{ systemPrompt, messages: [user] },
		{ apiKey: auth.apiKey, headers: auth.headers, signal, reasoning: cfg.inferenceThinking },
	);
	if (resp.stopReason === "aborted") return fallback;

	const raw = extractText(resp.content as Array<{ type: string; text?: string }>);
	const parsed = parseStrictJson<{ label?: string }>(raw);
	const label = (parsed?.label ?? "").trim();
	return isValidLabel(label) ? label : fallback;
}

export async function inferProseFormatting(
	ctx: ExtensionContext,
	cfg: PiDownloadConfig,
	words: string[],
	signal: AbortSignal,
): Promise<{ ok: boolean; body: string; model?: string; reason?: string }> {
	if (cfg.inferenceModelMode === "off") return { ok: false, body: "", reason: "off" };

	const picked = chooseCheapestTextModel(ctx, cfg);
	if (!picked.model) return { ok: false, body: "", reason: "no model" };
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(picked.model);
	if (!auth.ok || !auth.apiKey) return { ok: false, body: "", reason: "no api key" };

	// Chunk to keep inference cheap and reduce failure blast radius.
	const chunkSize = 1200;
	const chunks: string[] = [];
	for (let i = 0; i < words.length; i += chunkSize) {
		chunks.push(words.slice(i, i + chunkSize).join(" "));
	}

	let out = "";
	for (let i = 0; i < chunks.length; i++) {
		const chunkText = chunks[i];
		const user: UserMessage = {
			role: "user",
			content: [
				{
					type: "text",
					text:
						"Return STRICT JSON only: {\"text\": string}.\n" +
						"Format the text into readable prose with sentences and paragraphs.\n" +
						"You MAY add punctuation and newlines.\n" +
						"You MUST NOT add, remove, reorder, translate, or change any words.\n" +
						"Keep every word token exactly as-is (same characters and casing).\n" +
						"Do not replace straight quotes/apostrophes with curly ones.\n\n" +
						`CHUNK ${i + 1}/${chunks.length}:\n${chunkText}`,
				},
			],
			timestamp: Date.now(),
		};

		const systemPrompt = "You are a formatter. Output JSON only.";
		const resp = await completeSimple(
			picked.model,
			{ systemPrompt, messages: [user] },
			{ apiKey: auth.apiKey, headers: auth.headers, signal, reasoning: cfg.inferenceThinking, maxTokens: 2200 },
		);
		if (resp.stopReason === "aborted") return { ok: false, body: "", reason: "aborted" };
		const raw = extractText(resp.content as Array<{ type: string; text?: string }>);
		const parsed = parseStrictJson<{ text?: string }>(raw);
		const piece = String(parsed?.text ?? "").replace(/\r/g, "").trim();
		if (!piece) return { ok: false, body: "", reason: "empty" };
		out += (out ? "\n\n" : "") + piece;
	}

	return { ok: true, body: out.trim(), model: `${picked.model.provider}/${picked.model.id}` };
}
