/// <reference lib="webworker" />
/**
 * Local speech-to-text (personal fork, 2026-10-24): Whisper running in a
 * Web Worker through transformers.js — no key, no cloud. The model
 * (~80MB) downloads from Hugging Face on first use and is cached by the
 * browser (Electron keeps it in the app's userData), so later runs are
 * offline. WebGPU when the machine has it, WebAssembly otherwise.
 *
 * Protocol (main ↔ worker, see components/whisper-client.ts):
 *   in  { type: "warm" }                                — start loading
 *   in  { type: "transcribe", id, audio: Float32Array } — 16kHz mono
 *   out { type: "progress", loaded: 0..1 }              — first download
 *   out { type: "result", id, text } | { type: "error", id?, message }
 */
import { pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

const MODEL = "onnx-community/whisper-base";

declare const self: DedicatedWorkerGlobalScope;

let loading: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

/** Download progress across the model's files, reported as one 0..1. */
const fileProgress = new Map<string, { loaded: number; total: number }>();
function onProgress(p: { status: string; file?: string; loaded?: number; total?: number }) {
	if (p.status !== "progress" || !p.file || !p.total) return;
	fileProgress.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
	let loaded = 0;
	let total = 0;
	for (const f of fileProgress.values()) {
		loaded += f.loaded;
		total += f.total;
	}
	self.postMessage({ type: "progress", loaded: total ? loaded / total : 0 });
}

async function create(): Promise<AutomaticSpeechRecognitionPipeline> {
	const gpu = (self.navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
	if (gpu && (await gpu.requestAdapter().catch(() => null))) {
		try {
			return (await pipeline("automatic-speech-recognition", MODEL, {
				device: "webgpu",
				dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
				progress_callback: onProgress,
			})) as AutomaticSpeechRecognitionPipeline;
		} catch {
			// Fall through to the WebAssembly build below.
		}
	}
	return (await pipeline("automatic-speech-recognition", MODEL, {
		device: "wasm",
		dtype: "q8",
		progress_callback: onProgress,
	})) as AutomaticSpeechRecognitionPipeline;
}

function load(): Promise<AutomaticSpeechRecognitionPipeline> {
	if (!loading) {
		loading = create().catch((e: unknown) => {
			loading = null; // a failed load (offline first run) retries next time
			throw e;
		});
	}
	return loading;
}

self.onmessage = async (e: MessageEvent<{ type: "warm" } | { type: "transcribe"; id: number; audio: Float32Array }>) => {
	const msg = e.data;
	if (msg.type === "warm") {
		load().catch((err: unknown) => self.postMessage({ type: "error", message: String(err) }));
		return;
	}
	try {
		const asr = await load();
		// 30s windows with overlap: Whisper's native context, so long
		// dictations transcribe whole.
		const out = await asr(msg.audio, { chunk_length_s: 30, stride_length_s: 5 });
		const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text).trim();
		self.postMessage({ type: "result", id: msg.id, text });
	} catch (err) {
		self.postMessage({ type: "error", id: msg.id, message: err instanceof Error ? err.message : String(err) });
	}
};
