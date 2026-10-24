// Signs the Gemini (Antigravity) engine in to your Google account. The
// login is saved under ~/.gemini/antigravity-acp/ for later runs.
// Logic: src/server/antigravity-setup.ts.
//   npm run login:gemini
import { exec } from "node:child_process";
import { geminiLoginState, startGeminiLogin } from "../src/server/antigravity-setup.ts";

try {
	startGeminiLogin();
} catch (err) {
	console.error(`${err instanceof Error ? err.message : String(err)}. Run \`npm run setup:gemini\` first.`);
	process.exit(1);
}
console.log("Starting Google's Antigravity server (about 15 seconds)…");
let opened = false;
const timer = setInterval(() => {
	const state = geminiLoginState();
	if (!state) return;
	if (state.url && !opened) {
		opened = true;
		console.log("\nSign in with Google in your browser. If it didn't open, open this link:\n");
		console.log(state.url, "\n");
		const open = { win32: 'start ""', darwin: "open" }[process.platform as string] ?? "xdg-open";
		exec(`${open} "${state.url.replace(/"/g, "")}"`);
	}
	if (state.status === "done" || state.status === "error") {
		clearInterval(timer);
		if (state.error) console.error("Sign-in failed:", state.error);
		else console.log("Signed in. The app can now use Gemini on your Google account.");
		process.exit(state.error ? 1 : 0);
	}
}, 250);
