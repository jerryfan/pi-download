export function slugifyLabel(input: string, maxLen = 32): string {
	const lower = input.toLowerCase();
	const cleaned = lower
		.replace(/&/g, " and ")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	if (!cleaned) return "dl";
	return cleaned.length <= maxLen ? cleaned : cleaned.slice(0, maxLen).replace(/-+$/g, "");
}

export function isValidLabel(label: string): boolean {
	return /^[a-z0-9-]{1,32}$/.test(label);
}
