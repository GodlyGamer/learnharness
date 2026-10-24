"use client";

import { useCallback, useState } from "react";
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

/** The photo state every composer shares: add (files → JPEG), remove,
 *  clear, and the last attach error (e.g. HEIC, which browsers can't
 *  decode). Capped at MAX_CHAT_IMAGES, the server's per-message limit. */
export function useChatPhotos(max: number) {
	const [photos, setPhotos] = useState<ChatPhoto[]>([]);
	const [error, setError] = useState<string | null>(null);
	const add = useCallback(
		(files: File[]) => {
			setError(null);
			filesToChatPhotos(files)
				.then((added) => setPhotos((ps) => [...ps, ...added].slice(0, max)))
				.catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
		},
		[max],
	);
	const remove = useCallback((id: string) => setPhotos((ps) => ps.filter((p) => p.id !== id)), []);
	const clear = useCallback(() => setPhotos([]), []);
	return { photos, add, remove, clear, error };
}

/* The first message of a NEW session (home / new-session composers): the
 * session is created first, then the chat page sends the opening message
 * — photos can't ride the URL, so they wait here, in memory, keyed by the
 * new chat id, for the chat page to take (client navigation keeps the
 * module alive). */
const firstMessagePhotos = new Map<string, ChatPhoto[]>();

export function stashFirstMessagePhotos(chatId: string, photos: readonly ChatPhoto[]): void {
	if (photos.length) firstMessagePhotos.set(chatId, [...photos]);
}

export function peekFirstMessagePhotos(chatId: string): readonly ChatPhoto[] {
	return firstMessagePhotos.get(chatId) ?? [];
}

export function takeFirstMessagePhotos(chatId: string): ChatPhoto[] {
	const photos = firstMessagePhotos.get(chatId) ?? [];
	firstMessagePhotos.delete(chatId);
	return photos;
}
