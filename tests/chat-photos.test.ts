import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ChatInputError, inputAppends, parseChatInput } from "../src/core/input-events.ts";
import { newUserMessage, toLlmMessages, userMessageText } from "../src/core/native-messages.ts";
import { projectView } from "../src/core/view.ts";

const PNG = "iVBORw0KGgo=";

describe("photos in chat messages (the composer's + button)", () => {
	it("a text input may carry photos, and then the text may be empty", () => {
		const input = parseChatInput({ type: "text", text: "", images: [{ data: PNG, mimeType: "image/png" }] });
		assert.deepEqual(input, { type: "text", text: "", images: [{ data: PNG, mimeType: "image/png" }] });
		assert.deepEqual(parseChatInput({ type: "text", text: "hi" }), { type: "text", text: "hi" }, "no photos, unchanged shape");
	});

	it("refuses bad photos honestly", () => {
		assert.throws(() => parseChatInput({ type: "text", text: "", images: [] }), ChatInputError, "no text, no photo");
		assert.throws(() => parseChatInput({ type: "text", text: "x", images: [{ data: PNG, mimeType: "image/heic" }] }), /JPEG, PNG/);
		assert.throws(() => parseChatInput({ type: "text", text: "x", images: [{ data: "not base64!", mimeType: "image/png" }] }), /base64/);
		assert.throws(
			() => parseChatInput({ type: "text", text: "x", images: Array.from({ length: 7 }, () => ({ data: PNG, mimeType: "image/png" })) }),
			/at most 6/,
		);
	});

	it("the user message holds text then image blocks; text-only messages stay plain strings", () => {
		const [m] = inputAppends({ messages: [] }, { type: "text", text: "Explain step 3", images: [{ data: PNG, mimeType: "image/png" }] });
		assert.deepEqual((m as { content: unknown }).content, [
			{ type: "text", text: "Explain step 3" },
			{ type: "image", data: PNG, mimeType: "image/png" },
		]);
		assert.equal(newUserMessage("plain").content, "plain");
		assert.deepEqual(newUserMessage("", [{ data: PNG, mimeType: "image/png" }]).content, [{ type: "image", data: PNG, mimeType: "image/png" }]);
	});

	it("the model sees the image blocks untouched", () => {
		const msg = newUserMessage("What's wrong here?", [{ data: PNG, mimeType: "image/png" }]);
		const [llm] = toLlmMessages([msg]);
		assert.deepEqual((llm as { content: unknown }).content, msg.content);
	});

	it("the transcript shows photos as file parts after the text", () => {
		const view = projectView([newUserMessage("Here", [{ data: PNG, mimeType: "image/png" }])]);
		const parts = view[0]!.parts as Array<{ type: string; text?: string; url?: string; mediaType?: string }>;
		assert.equal(parts[0]!.text, "Here");
		assert.deepEqual(parts[1], { type: "file", mediaType: "image/png", url: `data:image/png;base64,${PNG}` });
	});

	it("text-only readers see a [photo] placeholder", () => {
		assert.equal(userMessageText([{ type: "text", text: "Look" }, { type: "image", data: PNG, mimeType: "image/png" }]), "Look\n[photo]");
		assert.equal(userMessageText("plain"), "plain");
	});
});
