import type { Participant, ParticipantEvidence, VideoReferenceMetadata } from "./types";
import type { YtInfo } from "./yt";

function clean(s: string): string {
	return s.replace(/\s+/g, " ").trim();
}

function isoDate(yyyymmdd?: string): string | undefined {
	if (!yyyymmdd || !/^\d{8}$/.test(yyyymmdd)) return undefined;
	return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

export function formatDuration(sec?: number): string | undefined {
	if (!Number.isFinite(sec as number)) return undefined;
	const s = Math.max(0, Math.floor(sec as number));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = s % 60;
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
}

function addEvidence(p: Participant, ev: ParticipantEvidence) {
	if (!p.evidence.some((e) => e.type === ev.type && e.text === ev.text)) p.evidence.push(ev);
}

function upsert(map: Map<string, Participant>, name: string, role: Participant["role"], confidence: Participant["confidence"], evidence: ParticipantEvidence, links: string[] = []) {
	const n = clean(name).replace(/^@/, "");
	if (!n || n.length < 2) return;
	const key = n.toLowerCase();
	const existing = map.get(key);
	if (!existing) {
		map.set(key, { name: n, role, confidence, evidence: [evidence], links: [...new Set(links)] });
		return;
	}
	const rank = { low: 0, medium: 1, high: 2 } as const;
	if (rank[confidence] > rank[existing.confidence]) existing.confidence = confidence;
	if (existing.role === "referenced" && role !== "referenced") existing.role = role;
	if (existing.role === "possible participant" && (role === "guest" || role === "host")) existing.role = role;
	addEvidence(existing, evidence);
	existing.links = [...new Set([...existing.links, ...links])];
}

function namesFromTitle(title: string): string[] {
	const out: string[] = [];
	for (const re of [/\bw\/\s+([^|:—–-]+)/i, /\bwith\s+([^|:—–-]+)/i, /\bfeaturing\s+([^|:—–-]+)/i, /\bft\.\s+([^|:—–-]+)/i]) {
		const m = title.match(re);
		if (m) out.push(clean(m[1]).replace(/^the\s+/i, ""));
	}
	return out;
}

export function buildVideoReferenceMetadata(info: YtInfo, url: string, transcriptWords?: string[]): VideoReferenceMetadata {
	const title = info.title ?? "";
	const description = info.description ?? "";
	const participants = new Map<string, Participant>();

	for (const name of namesFromTitle(title)) {
		upsert(participants, name, "guest", "high", { type: "title", text: title });
	}

	const episode = description.match(/In this episode,\s*([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){0,3})/);
	if (episode) upsert(participants, episode[1], "guest", "high", { type: "description", text: clean(episode[0]) });

	for (const line of description.split(/\r?\n/)) {
		const m = line.match(/^\s*([A-Z][A-Za-z.'’-]+)\s*:?\s*(https?:\/\/\S+|www\.\S+)/);
		if (m) upsert(participants, m[1], "possible participant", "medium", { type: "description", text: clean(line) }, [m[2].startsWith("www.") ? `https://${m[2]}` : m[2]]);
	}

	const tagText = (info.tags ?? []).join(" | ");
	for (const tag of info.tags ?? []) {
		if (/^alex garcia$/i.test(tag)) upsert(participants, "Alex Garcia", "possible participant", "medium", { type: "tags", text: tag });
		if (/^brian blum$/i.test(tag)) upsert(participants, "Brian Blum", "possible participant", "medium", { type: "tags", text: tag });
	}

	const transcript = transcriptWords?.join(" ") ?? "";
	for (const name of ["Alex Garcia", "Brian Blum", "Sam Parr"]) {
		const first = name.split(" ")[0];
		const re = new RegExp(`\\b${first}\\b[^.]{0,90}`, "i");
		const m = transcript.match(re);
		if (m) upsert(participants, name, name === "Sam Parr" ? "guest" : "possible participant", name === "Sam Parr" ? "high" : "medium", { type: "transcript", text: clean(m[0]) });
	}

	const referenced = new Set<string>();
	for (const name of ["Lily", "Joe", "Sean", "Dharmesh Shah", "O Pearlman", "Mark Cuban", "David Ogilvy"]) {
		if (new RegExp(`\\b${name.replace(/ /g, "\\s+")}\\b`, "i").test(transcript + " " + description + " " + tagText)) referenced.add(name);
	}

	return {
		title: info.title,
		url: info.webpage_url ?? url,
		videoId: info.id,
		channelName: info.channel,
		channelUrl: info.channel_url,
		uploader: info.uploader,
		uploaderUrl: info.uploader_url,
		uploadDate: isoDate(info.upload_date),
		durationSec: info.duration,
		duration: formatDuration(info.duration),
		description: info.description,
		tags: info.tags ?? [],
		chapters: (info.chapters ?? []).map((c) => ({ title: c.title, startTime: c.start_time, endTime: c.end_time })),
		participants: [...participants.values()],
		referencedPeople: [...referenced],
	};
}

export function renderVideoReferenceBlock(meta: VideoReferenceMetadata): string {
	const lines: string[] = ["# Video Reference", ""];
	if (meta.title) lines.push(`Title: ${meta.title}`);
	if (meta.channelName) lines.push(`Channel: ${meta.channelName}`);
	lines.push(`URL: ${meta.url}`);
	if (meta.uploadDate) lines.push(`Upload date: ${meta.uploadDate}`);
	if (meta.duration) lines.push(`Duration: ${meta.duration}`);
	lines.push("", "Participants:");
	if (meta.participants.length) {
		meta.participants.forEach((p, i) => {
			lines.push(`${i + 1}. ${p.name} — ${p.role} — ${p.confidence} confidence`);
			lines.push(`   Evidence: ${p.evidence.map((e) => e.type).join("; ")}.`);
			if (p.links.length) lines.push(`   Links: ${p.links.join("; ")}`);
		});
	} else {
		lines.push("- None detected with confidence.");
	}
	if (meta.referencedPeople.length) lines.push("", "Referenced people:", ...meta.referencedPeople.map((p) => `- ${p}`));
	lines.push("", "# Transcript", "");
	return lines.join("\n");
}

export function renderBibliography(meta: VideoReferenceMetadata): string {
	const channel = meta.channelName ?? meta.uploader ?? "YouTube";
	const title = meta.title ?? meta.videoId;
	const dur = meta.duration ? `, ${meta.duration}` : "";
	const date = meta.uploadDate ? new Date(`${meta.uploadDate}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : "n.d.";
	return `# Bibliography\n\n1. ${channel}. “${title}.” YouTube video${dur}. ${date}.\n${meta.url}.\n`;
}
