"use client";
/**
 * Photos from the learner's device (personal fork, 2026-10-24): any image
 * the browser can decode → JPEG, long edge capped. Shared by the chat
 * composer's + button and the Practice papers hand-in.
 */

/** Re-encode as JPEG, long edge at most `maxEdge` px. */
export async function toJpeg(file: Blob, maxEdge = 3000): Promise<Blob> {
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
	const canvas = document.createElement("canvas");
	canvas.width = Math.round(bitmap.width * scale);
	canvas.height = Math.round(bitmap.height * scale);
	const ctx = canvas.getContext("2d")!;
	// JPEG has no alpha: transparent screenshots get a white page, not black.
	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();
	return new Promise((resolve, reject) =>
		canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not read that photo"))), "image/jpeg", 0.88),
	);
}

/** A chat attachment: base64 JPEG for the message, a data URL to preview. */
export interface ChatPhoto {
	id: string;
	data: string;
	mimeType: "image/jpeg";
	previewUrl: string;
}

/** Image files → chat attachments (2000px is plenty for Claude to read a
 *  page of working, and keeps the session record small). */
export async function filesToChatPhotos(files: Iterable<File>): Promise<ChatPhoto[]> {
	const out: ChatPhoto[] = [];
	for (const file of files) {
		if (!file.type.startsWith("image/")) continue;
		const jpeg = await toJpeg(file, 2000);
		const previewUrl = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(jpeg);
		});
		out.push({
			id: crypto.randomUUID(),
			data: previewUrl.slice(previewUrl.indexOf(",") + 1),
			mimeType: "image/jpeg",
			previewUrl,
		});
	}
	return out;
}
