/**
 * Headless runs of the practice-paper skills (personal fork, 2026-10-24):
 * /make-papers <CODE> [topics] and /mark-attempts <CODE> <PAIR_ID>, each a
 * Claude Code session through the Agent SDK on the subscription login —
 * the same engine the tutor uses, so no key. The skills and their
 * subagents load from the repo's .claude/ (settingSources: project).
 *
 * The fence (SETUP_PROMPT.md §4, "limit file access to study/"): a
 * PreToolUse hook denies every file tool aimed outside study/ (reading
 * .claude/ is allowed — that's where the skills and agents live) and
 * points path-less Glob/Grep at study/. Marking also gets no Bash at all;
 * paper generation needs Bash for Python (sympy/PyMuPDF) and latexmk.
 *
 * Jobs live in memory (one per module at a time) with a log file under
 * study/modules/<CODE>/.jobs/ for anything worth reading afterwards.
 */

import fs from "node:fs";
import path from "node:path";
import { query, type HookCallback, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ROOT } from "../../config.ts";
import { childEnv } from "../agent/claude-code.ts";
import { insideStudy, listModuleCodes, moduleDir, moduleInfo, studyRoot } from "./study.ts";
import { syncPairToGraph } from "./study-graph.ts";
import { stores } from "./stores.ts";

export type StudyJobKind = "make-papers" | "mark-attempts";

export interface StudyJob {
	id: string;
	kind: StudyJobKind;
	module: string;
	pair: string | null;
	status: "running" | "done" | "error";
	startedAt: string;
	endedAt: string | null;
	/** The latest progress lines (assistant text), newest last. */
	progress: string[];
	/** The skill's closing reply (its summary), or the error. */
	result: string | null;
}

const jobs = new Map<string, StudyJob>();
const controllers = new Map<string, AbortController>();

export function listStudyJobs(): StudyJob[] {
	return [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

const FILE_TOOLS = new Set(["Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "Glob", "Grep"]);

/** The PreToolUse fence: file tools stay inside study/ (reads of .claude/
 *  allowed); Glob/Grep without a path search study/. */
export const studyFence: HookCallback = async (input) => {
	if (input.hook_event_name !== "PreToolUse" || !FILE_TOOLS.has(input.tool_name)) return {};
	const args = (input.tool_input ?? {}) as Record<string, unknown>;
	const raw = (args.file_path ?? args.notebook_path ?? args.path) as string | undefined;
	if (raw === undefined) {
		return {
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "allow",
				updatedInput: { ...args, path: studyRoot() },
			},
		};
	}
	const abs = path.resolve(ROOT, raw);
	const readOnly = input.tool_name === "Read" || input.tool_name === "Glob" || input.tool_name === "Grep";
	const inClaude = abs.startsWith(path.join(ROOT, ".claude") + path.sep);
	if (insideStudy(abs) || (readOnly && inClaude)) return {};
	return {
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "deny",
			permissionDecisionReason: `File access is limited to ${studyRoot()} (asked for ${abs}).`,
		},
	};
};

/** PATH for the run: Strawberry Perl (latexmk needs it under MiKTeX) is
 *  prepended when installed, in case the app started before the install. */
function jobEnv(): Record<string, string | undefined> {
	const env = childEnv();
	if (process.platform === "win32") {
		const extra = ["C:\\Strawberry\\perl\\bin", "C:\\Strawberry\\c\\bin"].filter((p) => fs.existsSync(p));
		const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
		env[key] = [...extra, env[key] ?? ""].join(path.delimiter);
	}
	return env;
}

function textOf(msg: SDKMessage): string | null {
	if (msg.type !== "assistant" || msg.parent_tool_use_id !== null) return null;
	const text = msg.message.content
		.map((c) => (c.type === "text" ? c.text : ""))
		.join("")
		.trim();
	return text || null;
}

export function startStudyJob(kind: StudyJobKind, code: string, args: { pair?: string; topics?: string }): StudyJob {
	if (!listModuleCodes().includes(code)) throw new Error(`no module ${code}`);
	const busy = [...jobs.values()].find((j) => j.module === code && j.status === "running");
	if (busy) throw new Error(`a ${busy.kind} run is already going for ${code}`);
	if (kind === "mark-attempts" && !args.pair) throw new Error("marking needs a paper pair");

	const now = new Date();
	const job: StudyJob = {
		id: `job_${now.getTime().toString(36)}`,
		kind,
		module: code,
		pair: args.pair ?? null,
		status: "running",
		startedAt: now.toISOString(),
		endedAt: null,
		progress: [],
		result: null,
	};
	jobs.set(job.id, job);
	const prompt =
		kind === "make-papers"
			? `/make-papers ${code}${args.topics?.trim() ? ` ${args.topics.trim()}` : ""}`
			: `/mark-attempts ${code} ${args.pair}`;
	void run(job, prompt);
	return job;
}

export function cancelStudyJob(id: string): void {
	controllers.get(id)?.abort();
}

async function run(job: StudyJob, prompt: string): Promise<void> {
	const logDir = path.join(moduleDir(job.module), ".jobs");
	fs.mkdirSync(logDir, { recursive: true });
	const log = (line: string) => fs.appendFileSync(path.join(logDir, `${job.id}.log`), `${line}\n`, "utf-8");
	log(`${job.startedAt} ${prompt}`);
	const abort = new AbortController();
	controllers.set(job.id, abort);
	const before = new Set(moduleInfo(job.module).pairs.map((p) => p.id));

	try {
		const q = query({
			prompt,
			options: {
				cwd: ROOT,
				model: "claude-opus-5-5",
				settingSources: ["project"],
				skills: [job.kind],
				tools:
					job.kind === "make-papers"
						? ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Agent", "TodoWrite"]
						: ["Read", "Write", "Edit", "Glob", "Grep", "TodoWrite"],
				disallowedTools: ["WebFetch", "WebSearch"],
				permissionMode: "bypassPermissions",
				allowDangerouslySkipPermissions: true,
				hooks: { PreToolUse: [{ hooks: [studyFence] }] },
				persistSession: false,
				env: jobEnv(),
				abortController: abort,
			},
		});
		for await (const msg of q) {
			const text = textOf(msg);
			if (text) {
				job.progress = [...job.progress, text].slice(-12);
				log(text);
			}
			if (msg.type === "result") {
				job.result = "result" in msg && typeof msg.result === "string" ? msg.result : `Stopped: ${msg.subtype}`;
				job.status = msg.subtype === "success" && !msg.is_error ? "done" : "error";
			}
		}
		if (job.status === "running") job.status = "done";
	} catch (err) {
		job.status = "error";
		job.result = abort.signal.aborted ? "Cancelled." : err instanceof Error ? err.message : String(err);
	} finally {
		controllers.delete(job.id);
		job.endedAt = new Date().toISOString();
		log(`${job.endedAt} ${job.status}: ${job.result ?? ""}`);
	}

	// New pairs join the knowledge graph as soon as they exist.
	if (job.kind === "make-papers") {
		for (const pair of moduleInfo(job.module).pairs) {
			if (before.has(pair.id)) continue;
			try {
				syncPairToGraph(stores.graphStore, job.module, pair.id);
			} catch (err) {
				log(`graph import failed for ${pair.id}: ${String(err)}`);
			}
		}
	}
}
