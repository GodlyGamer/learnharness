/**
 * Installing and signing in the Gemini engine's backend, Google's
 * Antigravity ACP server (personal fork, 2026-10-24). Used by the desktop
 * app's setup screen and by `npm run setup:gemini` / `login:gemini`.
 *
 * Install, straight from the official ACP registry:
 *   1. read the registry's "antigravity-acp" entry for this platform;
 *   2. download the archive it lists (only from dl.google.com);
 *   3. refuse it unless its SHA-256 matches the registry's;
 *   4. unpack it; on Windows also require a valid "Google LLC" signature;
 *   5. record it in installed.json, which the engine reads.
 * Everything lands in antigravityDir() — per machine, never synced.
 *
 * Sign-in: start the server, `initialize`, `authenticate oauth-personal`;
 * the server prints a Google sign-in link on stderr and waits on 127.0.0.1
 * for the redirect. The token lands in ~/.gemini/antigravity-acp/.
 */

import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { antigravityDir, antigravityInstalled, antigravitySignedIn, installedAntigravity, stopAntigravity } from "../agent/antigravity.ts";

const REGISTRY = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const AGENT_ID = "antigravity-acp";

type Progress = (line: string) => void;

function platformKey(): string {
	const arch = ({ x64: "x86_64", arm64: "aarch64" } as Record<string, string>)[process.arch];
	const plat = ({ win32: "windows", darwin: "darwin", linux: "linux" } as Record<string, string>)[process.platform];
	if (!arch || !plat) throw new Error(`no Antigravity build for ${process.platform}/${process.arch}`);
	return `${plat}-${arch}`;
}

const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Windows: every .exe must carry a valid Authenticode signature from Google LLC. */
function verifySignatures(dir: string, progress: Progress): void {
	if (process.platform !== "win32") return;
	for (const exe of fs.readdirSync(dir).filter((f) => f.endsWith(".exe"))) {
		const r = spawnSync(
			"powershell",
			["-NoProfile", "-Command", `$s = Get-AuthenticodeSignature ${psQuote(path.join(dir, exe))}; "$($s.Status)|$($s.SignerCertificate.Subject)"`],
			{ encoding: "utf-8", windowsHide: true },
		);
		const [status, subject = ""] = (r.stdout ?? "").trim().split("|");
		if (status !== "Valid" || !/CN=Google LLC/.test(subject)) throw new Error(`${exe} is not validly signed by Google LLC (${status} ${subject})`);
		progress(`✓ ${exe} signed by Google LLC`);
	}
}

interface RegistryBuild {
	archive: string;
	sha256: string;
	cmd: string;
	args?: string[];
}

/** Download, verify and unpack the registry's current build. `force`
 *  re-downloads a version that's already installed. */
export async function installAntigravity(progress: Progress = () => {}, { force = false } = {}): Promise<{ version: string }> {
	progress("Reading the ACP registry…");
	const res = await fetch(REGISTRY);
	if (!res.ok) throw new Error(`the registry returned ${res.status}`);
	const registry = (await res.json()) as { agents?: unknown[] } | unknown[];
	const agents = (Array.isArray(registry) ? registry : (registry.agents ?? Object.values(registry))) as Array<{
		id?: string;
		version?: string;
		distribution?: { binary?: Record<string, RegistryBuild> };
	}>;
	const entry = agents.find((a) => a?.id === AGENT_ID);
	if (!entry?.version) throw new Error(`the registry has no "${AGENT_ID}" entry`);
	const key = platformKey();
	const build = entry.distribution?.binary?.[key];
	if (!build?.archive || !build.sha256 || !build.cmd) throw new Error(`the registry lists no ${key} build of ${AGENT_ID}`);
	const url = new URL(build.archive);
	if (url.protocol !== "https:" || url.hostname !== "dl.google.com") throw new Error(`unexpected download host ${url.host}`);

	const version = entry.version;
	const dest = path.join(antigravityDir(), version);
	const cmd = path.join(dest, build.cmd);
	progress(`Antigravity ACP server ${version} (${key})`);

	if (!force && fs.existsSync(cmd)) {
		progress("Already installed; re-checking it.");
		verifySignatures(dest, progress);
	} else {
		const zip = path.join(os.tmpdir(), `agy-acp-${version}-${process.pid}.zip`);
		try {
			progress(`Downloading ${url}…`);
			const dl = await fetch(url);
			if (!dl.ok || !dl.body) throw new Error(`the download returned ${dl.status}`);
			const hash = createHash("sha256");
			let bytes = 0;
			let shown = 0;
			const body = Readable.fromWeb(dl.body as import("node:stream/web").ReadableStream);
			body.on("data", (chunk: Buffer) => {
				hash.update(chunk);
				bytes += chunk.length;
				if (bytes - shown > 10e6) {
					shown = bytes;
					progress(`Downloaded ${(bytes / 1e6).toFixed(0)} MB…`);
				}
			});
			await pipeline(body, fs.createWriteStream(zip));
			const sha = hash.digest("hex");
			progress(`${(bytes / 1e6).toFixed(1)} MB, sha256 ${sha}`);
			if (sha !== build.sha256.toLowerCase()) throw new Error(`SHA-256 mismatch (the registry says ${build.sha256}); nothing was installed`);
			progress("✓ SHA-256 matches the registry");
			stopAntigravity(); // a running server would hold its files open
			fs.mkdirSync(dest, { recursive: true });
			const unzip =
				process.platform === "win32"
					? spawnSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath ${psQuote(zip)} -DestinationPath ${psQuote(dest)} -Force`], { windowsHide: true })
					: spawnSync("unzip", ["-o", zip, "-d", dest]);
			if (unzip.status !== 0 || !fs.existsSync(cmd)) throw new Error("could not unpack the archive");
		} finally {
			fs.rmSync(zip, { force: true });
		}
		if (process.platform !== "win32") fs.chmodSync(cmd, 0o755);
		verifySignatures(dest, progress);
	}

	fs.writeFileSync(
		path.join(antigravityDir(), "installed.json"),
		`${JSON.stringify({ version, cmd: build.cmd.replace(/^\.\//, ""), args: build.args ?? [], sha256: build.sha256 }, null, "\t")}\n`,
	);
	progress("Installed.");
	return { version };
}

export interface GeminiLogin {
	/** The Google sign-in link (null until the server prints it). */
	url: string | null;
	status: "starting" | "waiting" | "done" | "error";
	error: string | null;
}

let login: { state: GeminiLogin; stop: () => void } | null = null;

/** Start a Google sign-in (or return the one in progress). */
export function startGeminiLogin(): GeminiLogin {
	if (login && (login.state.status === "starting" || login.state.status === "waiting")) return login.state;
	if (!antigravityInstalled()) throw new Error("Gemini isn't installed yet");
	const { cmd, args } = installedAntigravity();
	const child = spawn(cmd, args, { cwd: path.dirname(cmd), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
	const state: GeminiLogin = { url: null, status: "starting", error: null };
	// The server re-launches itself on Windows: end the whole process tree.
	const stop = () => {
		if (child.exitCode !== null) return;
		if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
		else child.kill();
	};
	login?.stop();
	login = { state, stop };
	const send = (m: object) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
	const finish = (error: string | null) => {
		state.status = error ? "error" : "done";
		state.error = error;
		stop();
	};
	child.stderr.on("data", (d: Buffer) => {
		const url = /https:\/\/accounts\.google\.com\/[^\s"']+/.exec(d.toString())?.[0];
		if (url && !state.url) {
			state.url = url;
			state.status = "waiting";
		}
	});
	child.on("error", (err) => finish(err.message));
	child.on("exit", () => {
		if (state.status === "starting" || state.status === "waiting") finish("the sign-in stopped before it finished");
	});
	createInterface({ input: child.stdout }).on("line", (line) => {
		let m: { id?: number; method?: string; error?: { message?: string } };
		try {
			m = JSON.parse(line);
		} catch {
			return;
		}
		if (m.id === 1) send({ id: 2, method: "authenticate", params: { methodId: "oauth-personal" } });
		else if (m.id === 2) finish(m.error ? (m.error.message ?? "sign-in failed") : null);
		// The server asking us anything else: decline.
		else if (m.method && m.id !== undefined) send({ id: m.id, error: { code: -32601, message: "not supported" } });
	});
	send({
		id: 1,
		method: "initialize",
		params: { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } },
	});
	// Abandoned sign-ins don't keep the server running forever.
	setTimeout(() => {
		if (login?.state === state && state.status !== "done") finish("the sign-in timed out");
	}, 10 * 60_000).unref();
	return state;
}

export function geminiLoginState(): GeminiLogin | null {
	return login?.state ?? null;
}

export function geminiStatus(): { installed: boolean; version: string | null; signedIn: boolean } {
	const installed = antigravityInstalled();
	return { installed, version: installed ? installedAntigravity().version : null, signedIn: antigravitySignedIn() };
}

export interface GeminiInstall {
	status: "running" | "done" | "error";
	log: string[];
	error: string | null;
}

let install: GeminiInstall | null = null;

/** installAntigravity as a tracked job, for the setup screen. */
export function startGeminiInstall(): GeminiInstall {
	if (install?.status === "running") return install;
	const state: GeminiInstall = { status: "running", log: [], error: null };
	install = state;
	installAntigravity((line) => {
		// Download progress replaces itself instead of piling up.
		const log = /^Downloaded \d+ MB/.test(line) && /^Downloaded \d+ MB/.test(state.log.at(-1) ?? "") ? state.log.slice(0, -1) : state.log;
		state.log = [...log, line].slice(-40);
	}).then(
		() => {
			state.status = "done";
		},
		(err: unknown) => {
			state.status = "error";
			state.error = err instanceof Error ? err.message : String(err);
		},
	);
	return state;
}

export function geminiInstallState(): GeminiInstall | null {
	return install;
}
