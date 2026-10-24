import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@earendil-works/pi-ai";

// The engine reads the learner's Gemini login from GEMINI_CLI_HOME/.gemini
// and runs LH_GEMINI_CLI_SCRIPT in place of the real CLI.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "lh-gemini-home-"));
process.env.GEMINI_CLI_HOME = HOME;
process.env.LH_GEMINI_CLI_SCRIPT = fileURLToPath(new URL("./fixtures/fake-gemini-acp.mjs", import.meta.url));

const { geminiAuthType, GEMINI_CLI_PROVIDER_ID } = await import("../src/agent/gemini-cli.ts");
const { piModels } = await import("../src/agent/models.ts");

const quiz = {
	name: "quiz",
	description: "Pose a multiple-choice question.",
	parameters: Type.Object({ question: Type.String(), options: Type.Array(Type.String()) }),
};

function login(type: string | null) {
	fs.mkdirSync(path.join(HOME, ".gemini"), { recursive: true });
	const file = path.join(HOME, ".gemini", "settings.json");
	if (type === null) fs.rmSync(file, { force: true });
	else fs.writeFileSync(file, JSON.stringify({ security: { auth: { selectedType: type } } }));
}

async function step() {
	const model = piModels().getModel(GEMINI_CLI_PROVIDER_ID, "gemini-3.5-flash")!;
	const s = piModels().streamSimple(model, {
		systemPrompt: "You are a tutor.",
		messages: [{ role: "user", content: "Teach me limits.", timestamp: 0 }],
		tools: [quiz],
	});
	const events: string[] = [];
	for await (const e of s) events.push(e.type);
	return { events, message: await s.result() };
}

describe("the Gemini (Google login) engine", () => {
	it("registers keyless, zero-cost Gemini models", () => {
		const models = piModels().getModels(GEMINI_CLI_PROVIDER_ID);
		assert.ok(models.some((m) => m.id === "gemini-3.1-pro-preview"));
		for (const m of models) assert.equal(m.cost.input + m.cost.output, 0);
	});

	it("reads the learner's chosen Gemini auth type, never guesses one", () => {
		login(null);
		assert.equal(geminiAuthType(), null);
		login("oauth-personal");
		assert.equal(geminiAuthType(), "oauth-personal");
	});

	it("without a Gemini login, the step fails with the sign-in instructions", async () => {
		login(null);
		const { message } = await step();
		assert.equal(message.stopReason, "error");
		assert.match(message.errorMessage ?? "", /login:gemini/);
	});

	it("one ACP step: thinking + text stream, the tool call is captured with its arguments, the next response is cancelled", async () => {
		login("oauth-personal");
		const { events, message } = await step();
		assert.equal(message.stopReason, "toolUse", message.errorMessage);
		const thinking = message.content.find((c) => c.type === "thinking");
		const text = message.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
		const call = message.content.find((c) => c.type === "toolCall") as unknown as { name: string; arguments: { question: string; options: string[] } };
		assert.equal((thinking as { thinking: string }).thinking, "Checking prior knowledge.");
		assert.equal(text, "Quick check first.", "nothing from the cancelled next response");
		assert.equal(call.name, "quiz");
		assert.deepEqual(call.arguments.options, ["a", "b"]);
		assert.match(call.arguments.question, /Echo: Teach me limits\./, "the transcript reached Gemini as the prompt");
		assert.deepEqual(
			[...new Set(events)],
			["start", "thinking_start", "thinking_delta", "thinking_end", "text_start", "text_delta", "text_end", "toolcall_start", "toolcall_end", "done"],
		);
	});
});
