import type { Api, Model } from "@mariozechner/pi-ai";

export type InferenceModelMode = "auto-cheapest" | "pinned" | "off";

export type PiDownloadConfig = {
	defaultOutputRoot: string | null;
	maxHeight: number;
	subtitleLanguages: string[];
	subtitleMode: "manual-preferred" | "manual-only" | "auto-ok";
	proseTranscript: boolean;
	overwrite: "reuse" | "replace";
	inferenceModelMode: InferenceModelMode;
	pinnedInferenceModel: string | null; // provider/id
	inferenceThinking: "minimal" | "low" | "medium" | "high" | "xhigh";
	inferenceChunkTimeoutMs: number;
	throttle: {
		sleepIntervalSec: number;
		maxSleepIntervalSec: number;
		retries: number;
		fragmentRetries: number;
	};
};

export type SelectedSubtitle = {
	language: string;
	kind: "manual" | "auto";
	format: "vtt";
};

export type SubtitleCue = {
	index: number;
	startMs: number;
	endMs: number;
	text: string; // raw cue text (timing removed, whitespace normalized)
};

export type DuplicateSpan = {
	kind: "adjacent-duplicate" | "rolling-overlap";
	fromCue: number;
	toCue: number;
	text: string;
};

export type TranscriptAuditV1 = {
	version: 1;
	sourceLanguage: string;
	mode: "heuristic" | "llm-assisted" | "fallback-heuristic";
	verifierPassed: boolean;
	removedDuplicateSpans: DuplicateSpan[];
	stats: {
		rawCueCount: number;
		rawWordCount: number;
		outputWordCount: number;
		paragraphCount: number;
	};
	failureReason?: string;
};

export type ParticipantEvidence = { type: "title" | "description" | "channel" | "transcript" | "tags"; text: string };

export type Participant = {
	name: string;
	role: "host" | "guest" | "possible participant" | "referenced";
	confidence: "high" | "medium" | "low";
	evidence: ParticipantEvidence[];
	links: string[];
};

export type VideoReferenceMetadata = {
	title?: string;
	url: string;
	videoId: string;
	channelName?: string;
	channelUrl?: string;
	uploader?: string;
	uploaderUrl?: string;
	uploadDate?: string;
	durationSec?: number;
	duration?: string;
	description?: string;
	tags: string[];
	chapters: Array<{ title?: string; startTime?: number; endTime?: number }>;
	participants: Participant[];
	referencedPeople: string[];
};

export type ManifestV1 = {
	version: 1;
	extension: { name: "pi-download"; version: string };
	source: {
		provider: "youtube";
		url: string;
		videoId: string;
		title?: string;
		channel?: string;
		channelUrl?: string;
		uploader?: string;
		uploaderUrl?: string;
		uploadDate?: string;
		durationSec?: number;
		description?: string;
		tags?: string[];
		chapters?: Array<{ title?: string; startTime?: number; endTime?: number }>;
	};
	participants?: Participant[];
	referencedPeople?: string[];
	request: {
		outDir: string;
		maxHeight: number;
		subtitleLanguages: string[];
		subtitleMode: string;
		proseTranscript: boolean;
		overwrite: string;
	};
	selectedFormats: {
		video?: { formatId: string; ext: string; height?: number };
		audio?: { formatId: string; ext: string; abr?: number };
		subtitles: Array<{ language: string; kind: "manual" | "auto"; ext: string }>;
	};
	outputs: {
		videoPath?: string;
		audioPath?: string;
		rawSubtitlePaths: string[];
		proseTranscriptPaths: string[];
		auditPaths: string[];
		manifestPath: string;
		debugPath?: string;
	};
	cleanup: {
		mode: "heuristic" | "llm-assisted" | "fallback-heuristic";
		model?: string;
		verifierPassed: boolean;
		duplicateSpanCount: number;
	};
};

export type ModelRef = { provider: string; id: string };
export type ModelPick = { model: Model<Api> | null; reason: string };
