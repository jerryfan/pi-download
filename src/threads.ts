import { writeFile } from "node:fs/promises";

export type ThreadsInfo = {
	id: string;
	title: string;
	webpage_url: string;
	extractor_key: "Threads";
	videoUrl: string;
};

function videoId(url: string): string {
	const match = new URL(url).pathname.match(/\/post\/([^/?#]+)/);
	if (!match?.[1]) throw new Error("Threads URL must be a post permalink");
	return match[1];
}

function findVideoUrl(html: string): string {
	const tag = html.match(/<a\b(?=[^>]*\btitle=["']Download Video["'])(?=[^>]*\bhref=["'][^"']+)[^>]*>/i)?.[0];
	const href = tag?.match(/\bhref=["']([^"']+)/i)?.[1]?.replace(/&amp;/g, "&");
	if (!href) throw new Error("Threads downloader returned no video");
	return href;
}

export async function threadsInspect(url: string, signal?: AbortSignal): Promise<ThreadsInfo> {
	const response = await fetch("https://lovethreads.net/api/ajaxSearch", {
		method: "POST",
		headers: {
			"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
			origin: "https://lovethreads.net",
			referer: "https://lovethreads.net/en",
			"x-requested-with": "XMLHttpRequest",
		},
		body: new URLSearchParams({ q: url, t: "media", lang: "en" }).toString(),
		signal,
	});
	if (!response.ok) throw new Error(`Threads downloader failed: HTTP ${response.status}`);
	const data = (await response.json()) as { status?: string; data?: string };
	if (data.status !== "ok" || !data.data) throw new Error("Threads downloader found no public media");
	const id = videoId(url);
	return { id, title: `Threads ${id}`, webpage_url: url, extractor_key: "Threads", videoUrl: findVideoUrl(data.data) };
}

export async function threadsDownloadVideo(info: ThreadsInfo, outPath: string, signal?: AbortSignal): Promise<void> {
	const response = await fetch(info.videoUrl, { signal });
	if (!response.ok) throw new Error(`Threads video download failed: HTTP ${response.status}`);
	const type = response.headers.get("content-type") ?? "";
	if (!type.startsWith("video/")) throw new Error(`Threads downloader returned ${type || "unknown content"}, not video`);
	await writeFile(outPath, Buffer.from(await response.arrayBuffer()));
}
