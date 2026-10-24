/**
 * The Gemini (Google login) engine (personal fork, 2026-10-24): a pi-ai
 * provider whose stream runs ONE model step through Google's official
 * Gemini CLI in ACP mode (Agent Client Protocol — JSON-RPC over stdio,
 * the protocol IDEs use to drive Gemini). Requests ride the user's own
 * Gemini CLI login (Google AI Pro limits); no API key.
 *
 * Same shape as the Claude engine (src/agent/claude-code.ts), so every
 * agent and the UI bridge work unchanged:
 *   - pi-agent-core owns the loop; each pi model call is one ACP prompt;
 *   - the app's tools are served by an MCP server INSIDE this process
 *     (streamable HTTP on 127.0.0.1): Gemini's ACP notifications carry only
 *     a tool's display title, so the arguments are captured where they
 *     arrive — in the tool handler, which just acknowledges;
 *   - once the tool calls of a response are in and Gemini starts its next
 *     response, the prompt is cancelled and the calls go back to pi;
 *   - the app's system prompt replaces Gemini's (GEMINI_SYSTEM_MD), and a
 *     run-scoped system settings file switches every built-in tool off
 *     (GEMINI_CLI_SYSTEM_SETTINGS_PATH) — the learner's own Gemini CLI
 *     settings are never written;
 *   - the transcript is replayed as one tagged prompt (transcriptBlocks).
 */

import {
	createAssistantMessageEventStream,
	createProvider,
	getCurrentSystemPrompt,
	getCurrentTools,
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Model,
	type Provider,
	type SimpleStreamOptions,
	type Tool,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { TRANSCRIPT_NOTE, transcriptBlocks } from "./claude-code.ts";

export const GEMINI_CLI_PROVIDER_ID = "gemini-cli";
export const GEMINI_CLI_API = "gemini-cli-acp";

/** Models the Gemini CLI serves on a Google login, cloned from pi's
 *  Google catalog (context window, modalities stay authoritative). */
const GEMINI_MODEL_IDS = ["gemini-3.1-pro-preview", "gemini-3.5-flash", "gemini-3-flash-preview", "gemini-2.5-pro", "gemini-2.5-flash"];

const LOGIN_HINT =
	"Gemini CLI is not signed in on this computer. In the LearnHarness folder run `npm.cmd run login:gemini`, choose Sign in with Google, then try again.";

export function geminiCliProvider(googleModels: readonly Model<Api>[]): Provider {
	const models = GEMINI_MODEL_IDS.flatMap((id) => {
		const found = googleModels.find((m) => m.id === id);
		if (!found) return [];
		const { compat: _compat, ...base } = found;
		return [
			{
				...base,
				name: `${base.name} (Google login)`,
				provider: GEMINI_CLI_PROVIDER_ID,
				api: GEMINI_CLI_API,
				baseUrl: "",
				// Plan usage, not metered tokens: the cost meter reads zero.
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			} satisfies Model<Api>,
		];
	});
	return createProvider({
		id: GEMINI_CLI_PROVIDER_ID,
		name: "Gemini (Google login)",
		auth: {
			apiKey: {
				name: "Gemini CLI login",
				resolve: async () => ({ auth: {}, source: "Gemini CLI login" }),
			},
		},
		models,
		api: { stream: streamGeminiCli, streamSimple: streamGeminiCli },
	});
}

// ─── the learner's Gemini CLI login ─────────────────────────────────────────

/** ~/.gemini, or GEMINI_CLI_HOME's .gemini when the learner relocated it. */
function geminiHome(): string {
	return path.join(process.env.GEMINI_CLI_HOME ?? os.homedir(), ".gemini");
}

/** The auth type the learner chose in Gemini CLI (oauth-personal for
 *  "Sign in with Google"), or null when it was never set up. Authenticating
 *  ACP with any OTHER type would wipe the cached login, so it is read, never
 *  guessed. */
export function geminiAuthType(): string | null {
	try {
		const settings = JSON.parse(fs.readFileSync(path.join(geminiHome(), "settings.json"), "utf-8")) as {
			security?: { auth?: { selectedType?: unknown } };
			selectedAuthType?: unknown;
		};
		const t = settings.security?.auth?.selectedType ?? settings.selectedAuthType;
		return typeof t === "string" && t ? t : null;
	} catch {
		return null;
	}
}

/** The bundled CLI's entry script (an app dependency, pinned).
 *  LH_GEMINI_CLI_SCRIPT points elsewhere (the tests' fake ACP agent). */
function geminiScript(): string {
	if (process.env.LH_GEMINI_CLI_SCRIPT) return process.env.LH_GEMINI_CLI_SCRIPT;
	const require = createRequire(import.meta.url);
	return path.join(path.dirname(require.resolve("@google/gemini-cli/package.json")), "bundle", "gemini.js");
}

/** The child's environment: the parent's minus anything that would switch
 *  Gemini off the Google login (API keys, Vertex), plus the run's prompt
 *  and settings overrides. */
function childEnv(systemMd: string, settingsFile: string): Record<string, string | undefined> {
	const env: Record<string, string | undefined> = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (/^(GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_GENAI_USE_VERTEXAI|GOOGLE_GENAI_USE_GCA|GOOGLE_CLOUD_PROJECT|GEMINI_SYSTEM_MD)$/.test(k)) continue;
		env[k] = v;
	}
	env.GEMINI_SYSTEM_MD = systemMd;
	env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = settingsFile;
	env.NO_COLOR = "1";
	return env;
}

/** Run-scoped system settings: no built-in tools (an allowlist naming
 *  none), no folder-trust prompt, no usage statistics. */
const RUN_SETTINGS = {
	tools: { core: ["lh_no_builtin_tools"] },
	security: { folderTrust: { enabled: false } },
	privacy: { usageStatisticsEnabled: false },
};

// ─── the in-process tool server ─────────────────────────────────────────────

interface CapturedCall {
	name: string;
	args: Record<string, unknown>;
}

/** Serve the app's tools over streamable HTTP on a free local port. Every
 *  call is captured and acknowledged; pi runs the real execution. */
async function startToolServer(tools: readonly Tool[], onCall: (c: CapturedCall) => void) {
	const httpServer = http.createServer(async (req, res) => {
		const server = new McpServer({ name: "lh", version: "1.0.0" }, { capabilities: { tools: {} } });
		server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
			tools: tools.map((t) => ({
				name: t.name,
				description: t.description,
				inputSchema: t.parameters as { type: "object"; [k: string]: unknown },
			})),
		}));
		server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
			onCall({ name: request.params.name, args: (request.params.arguments ?? {}) as Record<string, unknown> });
			return { content: [{ type: "text" as const, text: "Received." }] };
		});
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
		res.on("close", () => {
			void transport.close();
			void server.close();
		});
		try {
			await server.connect(transport);
			await transport.handleRequest(req, res);
		} catch {
			if (!res.headersSent) res.writeHead(500).end();
		}
	});
	await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
	const port = (httpServer.address() as { port: number }).port;
	return { url: `http://127.0.0.1:${port}/mcp`, close: () => new Promise<void>((r) => httpServer.close(() => r())) };
}

// ─── a minimal ACP client (newline-delimited JSON-RPC 2.0) ──────────────────

type Json = Record<string, unknown>;

class AcpConnection {
	private nextId = 1;
	private pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void }>();
	stderr = "";

	constructor(
		private child: ChildProcessWithoutNullStreams,
		private onNotification: (method: string, params: Json) => void,
	) {
		createInterface({ input: child.stdout }).on("line", (line) => this.receive(line));
		child.stderr.on("data", (d: Buffer) => {
			this.stderr = (this.stderr + d.toString()).slice(-4000);
		});
		child.on("exit", (code) => {
			const err = new Error(`Gemini CLI exited (${code ?? "signal"})${this.stderr ? `: ${lastLine(this.stderr)}` : ""}`);
			for (const p of this.pending.values()) p.reject(err);
			this.pending.clear();
		});
	}

	request(method: string, params: Json): Promise<Json> {
		const id = this.nextId++;
		this.write({ jsonrpc: "2.0", id, method, params });
		return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
	}

	notify(method: string, params: Json): void {
		this.write({ jsonrpc: "2.0", method, params });
	}

	private write(msg: Json): void {
		if (this.child.stdin.writable) this.child.stdin.write(`${JSON.stringify(msg)}\n`);
	}

	private receive(line: string): void {
		let msg: Json;
		try {
			msg = JSON.parse(line) as Json;
		} catch {
			return; // stray non-protocol output
		}
		if (typeof msg.method === "string" && msg.id !== undefined) {
			this.answer(msg.id as number | string, msg.method, (msg.params ?? {}) as Json);
		} else if (typeof msg.method === "string") {
			this.onNotification(msg.method, (msg.params ?? {}) as Json);
		} else if (typeof msg.id === "number") {
			const p = this.pending.get(msg.id);
			if (!p) return;
			this.pending.delete(msg.id);
			if (msg.error) {
				const e = msg.error as { message?: string; data?: unknown };
				p.reject(new Error(e.message ?? "Gemini CLI request failed"));
			} else p.resolve((msg.result ?? {}) as Json);
		}
	}

	/** Requests FROM the agent: allow the app's own tools; refuse file and
	 *  terminal access (the client advertises neither capability). */
	private answer(id: number | string, method: string, params: Json): void {
		if (method === "session/request_permission") {
			const options = (params.options ?? []) as { optionId: string; kind?: string }[];
			const allow = options.find((o) => o.kind === "allow_once") ?? options.find((o) => o.kind?.startsWith("allow"));
			this.write({
				jsonrpc: "2.0",
				id,
				result: { outcome: allow ? { outcome: "selected", optionId: allow.optionId } : { outcome: "cancelled" } },
			});
			return;
		}
		this.write({ jsonrpc: "2.0", id, error: { code: -32601, message: `${method} is not available` } });
	}
}

function lastLine(s: string): string {
	return s.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
}

// ─── the stream ─────────────────────────────────────────────────────────────

export function streamGeminiCli(model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	const output: AssistantMessage = {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
	void run(model, context, options, stream, output);
	return stream;
}

async function run(
	model: Model<Api>,
	context: TranscriptContext,
	options: SimpleStreamOptions | undefined,
	stream: AssistantMessageEventStream,
	output: AssistantMessage,
): Promise<void> {
	let started = false;
	const start = () => {
		if (started) return;
		started = true;
		stream.push({ type: "start", partial: output });
	};
	const fail = (reason: "error" | "aborted", message?: string) => {
		closeOpenBlock();
		output.stopReason = reason;
		if (message) output.errorMessage = message;
		start();
		stream.push({ type: "error", reason, error: output });
	};

	// The open text/thinking block (Gemini streams chunks of one kind at a time).
	let open: { kind: "text" | "thinking"; index: number } | null = null;
	function closeOpenBlock() {
		if (!open) return;
		const block = output.content[open.index];
		if (block?.type === "text") stream.push({ type: "text_end", contentIndex: open.index, content: block.text, partial: output });
		if (block?.type === "thinking") stream.push({ type: "thinking_end", contentIndex: open.index, content: block.thinking, partial: output });
		open = null;
	}
	function appendChunk(kind: "text" | "thinking", delta: string) {
		if (!delta) return;
		start();
		if (open?.kind !== kind) {
			closeOpenBlock();
			const index = output.content.length;
			output.content.push(kind === "text" ? { type: "text", text: "" } : { type: "thinking", thinking: "" });
			open = { kind, index };
			stream.push({ type: kind === "text" ? "text_start" : "thinking_start", contentIndex: index, partial: output });
		}
		const block = output.content[open.index]!;
		if (block.type === "text") {
			block.text += delta;
			stream.push({ type: "text_delta", contentIndex: open.index, delta, partial: output });
		} else if (block.type === "thinking") {
			block.thinking += delta;
			stream.push({ type: "thinking_delta", contentIndex: open.index, delta, partial: output });
		}
	}

	const authType = geminiAuthType();
	if (!authType) {
		fail("error", LOGIN_HINT);
		return;
	}

	const tools = getCurrentTools(context.messages);
	const calls: CapturedCall[] = [];
	let toolPhase = false; // a tool call of THIS response has been seen
	let finishing = false;
	let cancelNext: (() => void) | null = null;

	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-gemini-"));
	const systemMd = path.join(dir, "system.md");
	const settingsFile = path.join(dir, "settings.json");
	fs.writeFileSync(systemMd, getCurrentSystemPrompt(context.messages) + TRANSCRIPT_NOTE, "utf-8");
	fs.writeFileSync(settingsFile, JSON.stringify(RUN_SETTINGS), "utf-8");

	let toolServer: Awaited<ReturnType<typeof startToolServer>> | null = null;
	let child: ChildProcessWithoutNullStreams | null = null;
	const onAbort = () => child?.kill();
	options?.signal?.addEventListener("abort", onAbort, { once: true });

	try {
		toolServer = await startToolServer(tools, (c) => {
			calls.push(c);
			toolPhase = true;
		});
		const proc = spawn(process.execPath, [geminiScript(), "--acp", "-m", model.id, "--allowed-mcp-server-names", "lh"], {
			cwd: dir,
			env: childEnv(systemMd, settingsFile) as NodeJS.ProcessEnv,
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		child = proc;
		const conn = new AcpConnection(proc, (method, params) => {
			if (method !== "session/update" || finishing) return;
			const update = (params.update ?? {}) as { sessionUpdate?: string; content?: { type?: string; text?: string } };
			const kind = update.sessionUpdate;
			if (kind === "tool_call") {
				toolPhase = true;
				return;
			}
			if (kind !== "agent_message_chunk" && kind !== "agent_thought_chunk") return;
			// Output after this response's tool calls is Gemini's NEXT
			// response: the step is over — cancel and hand the calls to pi.
			if (toolPhase && calls.length > 0) {
				finishing = true;
				cancelNext?.();
				return;
			}
			const text = update.content?.type === "text" ? (update.content.text ?? "") : "";
			appendChunk(kind === "agent_message_chunk" ? "text" : "thinking", text);
		});

		await conn.request("initialize", {
			protocolVersion: 1,
			clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
		});
		await conn.request("authenticate", { methodId: authType });
		const session = (await conn.request("session/new", {
			cwd: dir,
			mcpServers: tools.length ? [{ type: "http", name: "lh", url: toolServer.url, headers: [] }] : [],
		})) as { sessionId?: string };
		const sessionId = session.sessionId;
		if (!sessionId) throw new Error("Gemini CLI did not start a session");
		cancelNext = () => conn.notify("session/cancel", { sessionId });

		const prompt = transcriptBlocks(context.messages).map((b) =>
			b.type === "text"
				? { type: "text", text: b.text }
				: { type: "image", data: b.source.data, mimeType: b.source.media_type },
		);
		const result = (await conn.request("session/prompt", { sessionId, prompt })) as { stopReason?: string };

		if (options?.signal?.aborted) {
			fail("aborted");
			return;
		}
		closeOpenBlock();
		start();
		if (calls.length > 0) {
			for (const call of calls) {
				const index = output.content.length;
				const toolCall = { type: "toolCall" as const, id: `gcall_${randomUUID().slice(0, 12)}`, name: call.name, arguments: call.args as never };
				output.content.push(toolCall);
				stream.push({ type: "toolcall_start", contentIndex: index, partial: output });
				stream.push({ type: "toolcall_end", contentIndex: index, toolCall, partial: output });
			}
			output.stopReason = "toolUse";
			stream.push({ type: "done", reason: "toolUse", message: output });
			return;
		}
		if (result.stopReason === "refusal") {
			fail("error", "Gemini declined this request.");
			return;
		}
		output.stopReason = result.stopReason === "max_tokens" ? "length" : "stop";
		stream.push({ type: "done", reason: output.stopReason, message: output });
	} catch (err) {
		if (options?.signal?.aborted) fail("aborted");
		else {
			const message = err instanceof Error ? err.message : String(err);
			fail("error", /auth|login|credential|sign in/i.test(message) ? `${LOGIN_HINT} (${message})` : message);
		}
	} finally {
		options?.signal?.removeEventListener("abort", onAbort);
		child?.kill();
		await toolServer?.close();
		fs.rmSync(dir, { recursive: true, force: true });
	}
}
