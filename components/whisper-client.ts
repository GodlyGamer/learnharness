"use client";
/**
 * The main-thread side of local dictation (components/whisper.worker.ts):
 * one app-lifetime worker, created on first use. warm() starts the model
 * load early (dictation calls it when recording starts, so the download or
 * load overlaps the speaking); transcribe() resolves with the text.
 */

type WorkerOut =
	| { type: "progress"; loaded: number }
	| { type: "result"; id: number; text: string }
	| { type: "error"; id?: number; message: string };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (text: string) => void; reject: (e: Error) => void }>();
const progressListeners = new Set<(loaded: number) => void>();

function ensureWorker(): Worker {
	if (worker) return worker;
	worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
	worker.onmessage = (e: MessageEvent<WorkerOut>) => {
		const msg = e.data;
		if (msg.type === "progress") {
			for (const l of progressListeners) l(msg.loaded);
		} else if (msg.type === "result") {
			pending.get(msg.id)?.resolve(msg.text);
			pending.delete(msg.id);
		} else if (msg.id !== undefined) {
			pending.get(msg.id)?.reject(new Error(msg.message));
			pending.delete(msg.id);
		}
	};
	worker.onerror = (e) => {
		for (const p of pending.values()) p.reject(new Error(e.message || "speech model crashed"));
		pending.clear();
		worker = null; // a crashed worker is rebuilt on the next call
	};
	return worker;
}

export function warmWhisper(): void {
	ensureWorker().postMessage({ type: "warm" });
}

/** Transcribe 16kHz mono samples. The buffer is transferred (not copied). */
export function transcribe(audio: Float32Array): Promise<string> {
	const id = nextId++;
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject });
		ensureWorker().postMessage({ type: "transcribe", id, audio }, [audio.buffer]);
	});
}

/** First-run download progress (0..1); returns the unsubscribe. */
export function onWhisperProgress(listener: (loaded: number) => void): () => void {
	progressListeners.add(listener);
	return () => progressListeners.delete(listener);
}

/** Int16 PCM frames (the capture worklet's output) → one Float32 signal. */
export function framesToFloat32(frames: readonly Int16Array[]): Float32Array {
	let length = 0;
	for (const f of frames) length += f.length;
	const out = new Float32Array(length);
	let offset = 0;
	for (const f of frames) {
		for (let i = 0; i < f.length; i++) out[offset + i] = f[i]! / 0x8000;
		offset += f.length;
	}
	return out;
}
