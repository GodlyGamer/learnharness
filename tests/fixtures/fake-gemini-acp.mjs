// A fake `gemini --acp` for tests/gemini-cli.test.ts: speaks just enough
// ACP (newline-delimited JSON-RPC) and MCP to play one tool-calling step:
// think, say a sentence, call the app's `quiz` tool over the HTTP MCP
// server it was given, then start a "next response" — which the engine
// must answer with session/cancel.
import { createInterface } from "node:readline";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const send = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
const update = (sessionId, u) => send({ method: "session/update", params: { sessionId, update: u } });
let mcpUrl = null;
let cancelled = null;
const promptText = [];

createInterface({ input: process.stdin }).on("line", async (line) => {
	const msg = JSON.parse(line);
	if (msg.method === "initialize") return send({ id: msg.id, result: { protocolVersion: 1, agentCapabilities: {} } });
	if (msg.method === "authenticate") {
		if (msg.params.methodId !== "oauth-personal") return send({ id: msg.id, error: { code: -32000, message: "wrong auth type" } });
		return send({ id: msg.id, result: {} });
	}
	if (msg.method === "session/new") {
		mcpUrl = msg.params.mcpServers[0]?.url ?? null;
		return send({ id: msg.id, result: { sessionId: "s1" } });
	}
	if (msg.method === "session/cancel") return cancelled?.();
	if (msg.method === "session/prompt") {
		for (const b of msg.params.prompt) promptText.push(b.type === "text" ? b.text : `[${b.type}]`);
		update("s1", { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Checking prior knowledge." } });
		update("s1", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Quick check " } });
		update("s1", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "first." } });
		const client = new Client({ name: "fake-gemini", version: "0" });
		await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
		const { tools } = await client.listTools();
		update("s1", { sessionUpdate: "tool_call", toolCallId: "t1", status: "in_progress", title: tools[0].name });
		await client.callTool({ name: "quiz", arguments: { question: `Echo: ${promptText.join(" | ").slice(0, 60)}`, options: ["a", "b"] } });
		await client.close();
		// The next response begins; the engine must cancel here.
		const done = new Promise((r) => (cancelled = r));
		update("s1", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "SHOULD NOT APPEAR" } });
		await done;
		return send({ id: msg.id, result: { stopReason: "cancelled" } });
	}
	if (msg.id !== undefined) send({ id: msg.id, error: { code: -32601, message: "unsupported" } });
});
