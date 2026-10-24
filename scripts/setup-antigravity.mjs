// Installs Google's Antigravity ACP server — the Gemini engine's backend —
// into .tools/antigravity-acp/<version>/, straight from the official ACP
// registry (cdn.agentclientprotocol.com):
//   1. read the registry's "antigravity-acp" entry for this platform;
//   2. download the archive from the URL it lists (Google's dl.google.com);
//   3. refuse it unless its SHA-256 matches the registry's;
//   4. unpack it; on Windows also require a valid "Google LLC" signature;
//   5. record the version in .tools/antigravity-acp/installed.json, which
//      the engine and `npm run login:gemini` read.
// An install of the same version that's already present is re-verified
// (signature) instead of re-downloaded; --force downloads anyway.
//   npm run setup:gemini [-- --force]
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const REGISTRY = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const AGENT_ID = "antigravity-acp";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const toolsDir = path.join(root, ".tools", "antigravity-acp");
const force = process.argv.includes("--force");

const fail = (msg) => {
	console.error(`\nSetup failed: ${msg}`);
	process.exit(1);
};

function platformKey() {
	const arch = { x64: "x86_64", arm64: "aarch64" }[process.arch];
	const plat = { win32: "windows", darwin: "darwin", linux: "linux" }[process.platform];
	if (!arch || !plat) fail(`no Antigravity build for ${process.platform}/${process.arch}`);
	return `${plat}-${arch}`;
}

/** Windows: the binaries must carry a valid Authenticode signature from Google LLC. */
function verifySignatures(dir) {
	if (process.platform !== "win32") return;
	for (const exe of fs.readdirSync(dir).filter((f) => f.endsWith(".exe"))) {
		const file = path.join(dir, exe).replace(/'/g, "''");
		const r = spawnSync(
			"powershell",
			["-NoProfile", "-Command", `$s = Get-AuthenticodeSignature '${file}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`],
			{ encoding: "utf-8" },
		);
		const [status, subject = ""] = (r.stdout ?? "").trim().split("|");
		if (status !== "Valid" || !/CN=Google LLC/.test(subject)) fail(`${exe} is not validly signed by Google LLC (${status} ${subject})`);
		console.log(`  ✓ ${exe} signed by Google LLC`);
	}
}

console.log("Reading the ACP registry…");
const registry = await fetch(REGISTRY).then((r) => (r.ok ? r.json() : fail(`registry returned ${r.status}`)));
const agents = Array.isArray(registry) ? registry : (registry.agents ?? Object.values(registry));
const entry = agents.find((a) => a?.id === AGENT_ID);
if (!entry) fail(`the registry has no "${AGENT_ID}" entry`);
const key = platformKey();
const build = entry.distribution?.binary?.[key];
if (!build?.archive || !build?.sha256 || !build?.cmd) fail(`the registry lists no ${key} build of ${AGENT_ID}`);
const archiveUrl = new URL(build.archive);
if (archiveUrl.protocol !== "https:" || archiveUrl.hostname !== "dl.google.com") fail(`unexpected download host ${archiveUrl.host}`);

const version = entry.version;
const dest = path.join(toolsDir, version);
const cmdPath = path.join(dest, build.cmd);
console.log(`Antigravity ACP server ${version} (${key})`);

if (!force && fs.existsSync(cmdPath)) {
	console.log("Already installed; re-checking it.");
	verifySignatures(dest);
} else {
	const zip = path.join(os.tmpdir(), `agy-acp-${version}-${process.pid}.zip`);
	console.log(`Downloading ${archiveUrl}…`);
	const res = await fetch(archiveUrl);
	if (!res.ok || !res.body) fail(`download returned ${res.status}`);
	const hash = createHash("sha256");
	let bytes = 0;
	const body = Readable.fromWeb(res.body);
	body.on("data", (chunk) => {
		hash.update(chunk);
		bytes += chunk.length;
	});
	await pipeline(body, fs.createWriteStream(zip));
	const sha = hash.digest("hex");
	console.log(`  ${(bytes / 1e6).toFixed(1)} MB, sha256 ${sha}`);
	if (sha !== build.sha256.toLowerCase()) {
		fs.rmSync(zip, { force: true });
		fail(`SHA-256 mismatch (registry says ${build.sha256}); nothing was installed`);
	}
	console.log("  ✓ SHA-256 matches the registry");
	fs.mkdirSync(dest, { recursive: true });
	const unzip =
		process.platform === "win32"
			? spawnSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`], { stdio: "inherit" })
			: spawnSync("unzip", ["-o", zip, "-d", dest], { stdio: "inherit" });
	fs.rmSync(zip, { force: true });
	if (unzip.status !== 0 || !fs.existsSync(cmdPath)) fail("could not unpack the archive");
	if (process.platform !== "win32") fs.chmodSync(cmdPath, 0o755);
	verifySignatures(dest);
}

fs.writeFileSync(
	path.join(toolsDir, "installed.json"),
	`${JSON.stringify({ version, cmd: build.cmd.replace(/^\.\//, ""), args: build.args ?? [], sha256: build.sha256 }, null, "\t")}\n`,
);
console.log(`\nInstalled. Next: npm run login:gemini (sign in with Google once).`);
