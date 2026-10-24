// Logs the Claude subscription engine in (or reports its status) with the
// Claude Code binary the Agent SDK ships, so no separate install is needed.
//   npm run login           → sign in (opens the browser)
//   npm run login -- status → show the current login
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
let bin;
try {
	bin = path.join(path.dirname(require.resolve(`${pkg}/package.json`)), process.platform === "win32" ? "claude.exe" : "claude");
} catch {
	console.error(`No Claude Code binary for this platform (${pkg}). Run npm install first.`);
	process.exit(1);
}

// Same clean environment the engine gives its child process: no API key
// (that would bypass the subscription) and no nested-session variables.
const env = {};
for (const [k, v] of Object.entries(process.env)) {
	if (k === "ANTHROPIC_API_KEY" || k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_")) continue;
	env[k] = v;
}

const command = process.argv[2] === "status" ? "status" : "login";
spawn(bin, ["auth", command], { stdio: "inherit", env }).on("exit", (code) => process.exit(code ?? 0));
