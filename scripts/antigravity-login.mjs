// Signs the Gemini (Antigravity) engine in to your Google account, through
// Google's own Antigravity ACP server ("Log in with Google"). The server
// prints a Google sign-in link and listens on 127.0.0.1 for the redirect;
// the login is saved under ~/.gemini/antigravity-acp/ for later runs.
//   npm run login:gemini
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tools = path.join(root, ".tools", "antigravity-acp");
let installed = null;
try {
	installed = JSON.parse(fs.readFileSync(path.join(tools, "installed.json"), "utf-8"));
} catch {}
const exe = installed && path.join(tools, installed.version, installed.cmd);
if (!exe || !fs.existsSync(exe)) {
	console.error("The Antigravity ACP server is not installed. Run `npm run setup:gemini` first.");
	process.exit(1);
}

const child = spawn(exe, installed.args ?? [], { cwd: path.dirname(exe), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
// The server re-launches itself on Windows: end the whole process tree.
const stop = () => {
	if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
	else child.kill();
};
const send = (m) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
let opened = false;
child.stderr.on("data", (d) => {
	const text = d.toString();
	const url = /https:\/\/accounts\.google\.com\/[^\s"']+/.exec(text)?.[0];
	if (url && !opened) {
		opened = true;
		console.log("\nSign in with Google in your browser. If it didn't open, open this link:\n");
		console.log(url, "\n");
		const open = { win32: 'start ""', darwin: "open" }[process.platform] ?? "xdg-open";
		exec(`${open} "${url.replace(/"/g, "")}"`);
	}
});
console.log("Starting Google's Antigravity server (about 15 seconds)…");
createInterface({ input: child.stdout }).on("line", (line) => {
	let m;
	try {
		m = JSON.parse(line);
	} catch {
		return;
	}
	if (m.id === 1) send({ id: 2, method: "authenticate", params: { methodId: "oauth-personal" } });
	if (m.id === 2) {
		if (m.error) console.error("Sign-in failed:", m.error.message ?? JSON.stringify(m.error));
		else console.log("Signed in. The app can now use Gemini on your Google account.");
		stop();
		process.exit(m.error ? 1 : 0);
	}
	// The server asking us anything else: decline.
	if (m.method && m.id !== undefined) send({ id: m.id, error: { code: -32601, message: "not supported" } });
});
send({
	id: 1,
	method: "initialize",
	params: { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } },
});
