// Installs Google's Antigravity ACP server (the Gemini engine's backend)
// from the official ACP registry, SHA-256 checked and, on Windows,
// signature checked. Logic: src/server/antigravity-setup.ts.
//   npm run setup:gemini [-- --force]
import { installAntigravity } from "../src/server/antigravity-setup.ts";

try {
	await installAntigravity((line) => console.log(line), { force: process.argv.includes("--force") });
	console.log("Next: npm run login:gemini (sign in with Google once).");
} catch (err) {
	console.error(`\nSetup failed: ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
}
