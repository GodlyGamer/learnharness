import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Message } from "@earendil-works/pi-ai";
import { CLAUDE_CODE_PROVIDER_ID, transcriptBlocks } from "../src/agent/claude-code.ts";
import { piModels } from "../src/agent/models.ts";

const usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

describe("the Claude subscription engine", () => {
	it("registers keyless, zero-cost clones of the current Claude models", () => {
		const models = piModels().getModels(CLAUDE_CODE_PROVIDER_ID);
		const ids = models.map((m) => m.id);
		for (const id of ["claude-opus-5-5", "claude-sonnet-5-5"]) assert.ok(ids.includes(id), id);
		for (const m of models) {
			assert.equal(m.provider, CLAUDE_CODE_PROVIDER_ID);
			assert.equal(m.cost.input + m.cost.output, 0);
		}
	});

	it("a lone user message goes through verbatim", () => {
		const blocks = transcriptBlocks([{ role: "user", content: "Research photosynthesis.", timestamp: 0 }]);
		assert.deepEqual(blocks, [{ type: "text", text: "Research photosynthesis." }]);
	});

	it("history replays as one tagged block per message, tool calls and results included", () => {
		const messages: Message[] = [
			{ role: "system", content: "ignored here", timestamp: 0 },
			{ role: "user", content: "Teach me limits.", timestamp: 1 },
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "not replayed" },
					{ type: "text", text: "Quick check first." },
					{ type: "toolCall", id: "t1", name: "quiz", arguments: { question: "1/x at 0?" } },
				],
				api: "claude-agent-sdk",
				provider: CLAUDE_CODE_PROVIDER_ID,
				model: "claude-opus-5-5",
				usage,
				stopReason: "toolUse",
				timestamp: 2,
			},
			{
				role: "toolResult",
				toolCallId: "t1",
				toolName: "quiz",
				content: [{ type: "text", text: "Learner chose: undefined" }],
				isError: false,
				timestamp: 3,
			},
		];
		const texts = transcriptBlocks(messages).map((b) => (b.type === "text" ? b.text : "[image]"));
		assert.equal(texts[0], "<transcript>");
		assert.match(texts[1]!, /^<learner>\nTeach me limits\.\n<\/learner>$/);
		assert.match(texts[2]!, /Quick check first\./);
		assert.match(texts[2]!, /<tool_call id="t1" name="quiz">\{"question":"1\/x at 0\?"\}<\/tool_call>/);
		assert.ok(!texts[2]!.includes("not replayed"));
		assert.match(texts[3]!, /^<tool_result id="t1" name="quiz">\nLearner chose: undefined\n<\/tool_result>$/);
		assert.match(texts[4]!, /^<\/transcript>/);
		assert.equal(texts.length, 5);
	});
});

describe("transcript styles", () => {
	const history = [
		{ role: "user", content: "Quiz me.", timestamp: 0 },
		{
			role: "assistant",
			content: [{ type: "toolCall", id: "c1", name: "quiz", arguments: { question: "2+2?" } }],
			timestamp: 1,
		},
		{ role: "toolResult", toolCallId: "c1", toolName: "quiz", content: [{ type: "text", text: "answered a" }], isError: false, timestamp: 2 },
	] as unknown as Parameters<typeof transcriptBlocks>[0];

	it("Claude's tag style is unchanged", () => {
		const text = transcriptBlocks(history).map((b) => (b.type === "text" ? b.text : "")).join("\n");
		assert.match(text, /<tool_call id="c1" name="quiz">/);
		assert.match(text, /<tool_result id="c1" name="quiz">/);
	});

	it("the prose style writes no tags at all", () => {
		const text = transcriptBlocks(history, "prose").map((b) => (b.type === "text" ? b.text : "")).join("\n");
		assert.doesNotMatch(text, /<tool_call|<tool_result/);
		assert.match(text, /You used the quiz tool with/);
		assert.match(text, /The quiz tool returned: answered a/);
	});
});
