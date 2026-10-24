/**
 * study_log (personal fork, 2026-10-24): the tutor's half of the
 * practice-paper pipeline. In a session tagged with a module, the
 * teacher, prober and practitioner record — as it happens — which topics
 * were covered, how each attempt went, and any self-ratings, into
 * study/modules/<CODE>/sessions/<session>.json (SETUP_PROMPT.md §3).
 * /make-papers targets the next papers from exactly these records, so the
 * outcome categories and the step wording matter more than prose.
 *
 * The agent layer never imports the server: the composition root hands
 * in `append`, which writes the entry.
 */

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import type { StudyOutcome, TaxonomySubSkill } from "../../core/study.ts";

export type StudyLogWrite =
	| { kind: "topic"; topic: { topic_id: string | null; sub_skill_id: string | null; label: string } }
	| {
			kind: "event";
			event: {
				sub_skill_id: string | null;
				label: string;
				prompt_ref: string | null;
				outcome: StudyOutcome;
				step: string;
				hints_used: number;
				confidence: number | null;
			};
	  }
	| { kind: "self_rating"; rating: { sub_skill_id: string | null; label: string; confidence: number } };

export interface StudyLogContext {
	module: string;
	chatId: string;
	taxonomy: TaxonomySubSkill[];
	append: (entry: StudyLogWrite) => void;
}

const studyLogInput = Type.Object({
	kind: Type.Union([Type.Literal("topic"), Type.Literal("attempt"), Type.Literal("self_rating")], {
		description: "topic: a topic or sub-skill was taught. attempt: the learner answered a question or problem. self_rating: the learner rated their own confidence on a sub-skill.",
	}),
	label: Type.String({ description: "A short descriptive label for the topic or sub-skill, always given." }),
	topic_id: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "Taxonomy topic id, or null when none fits." })),
	sub_skill_id: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "Taxonomy sub-skill id, or null when none fits. Never guess." })),
	// Literals spelled out (not mapped from STUDY_OUTCOMES) so the static
	// type stays the exact union; the test pins the two lists together.
	outcome: Type.Optional(
		Type.Union(
			[Type.Literal("correct"), Type.Literal("method_gap"), Type.Literal("slip"), Type.Literal("needed_hint"), Type.Literal("skipped")],
			{ description: "attempt only: correct | method_gap | slip | needed_hint | skipped" },
		),
	),
	step: Type.Optional(Type.String({ description: "attempt only: the specific step, e.g. 'set the limits of the inner integral'." })),
	hints_used: Type.Optional(Type.Integer({ minimum: 0, description: "attempt only: hints given before the answer." })),
	confidence: Type.Optional(
		Type.Union([Type.Integer({ minimum: 1, maximum: 5 }), Type.Null()], {
			description: "1-5: the learner's confidence asked BEFORE the attempt (or the self-rating). Null when not asked.",
		}),
	),
	prompt_ref: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "attempt only: the tool call id of the question or problem answered." })),
});

export const studyLogInputSchema = () => studyLogInput;

export function studyLogTool(ctx: StudyLogContext): AgentTool<typeof studyLogInput> {
	const known = new Set(ctx.taxonomy.map((t) => t.id));
	// An id outside the taxonomy would misfile the evidence silently; keep
	// the label and drop the id instead (SETUP_PROMPT.md §3).
	const id = (v: string | null | undefined) => (v && known.has(v) ? v : null);
	return {
		name: "study_log",
		label: "study log",
		description: `Record study evidence for module ${ctx.module} into its session log. Call it the moment something happens: once per topic or sub-skill taught (kind "topic"), after every learner attempt at a question or problem (kind "attempt", with outcome, step, hints_used, confidence), and when the learner rates themselves (kind "self_rating").`,
		parameters: studyLogInput,
		execute: serverExecute("study_log", studyLogInput, async (input) => {
			if (input.kind === "topic") {
				ctx.append({ kind: "topic", topic: { topic_id: id(input.topic_id), sub_skill_id: id(input.sub_skill_id), label: input.label } });
			} else if (input.kind === "attempt") {
				if (!input.outcome) throw new Error("an attempt needs an outcome");
				if (!input.step?.trim()) throw new Error("an attempt needs the specific step");
				ctx.append({
					kind: "event",
					event: {
						sub_skill_id: id(input.sub_skill_id),
						label: input.label,
						prompt_ref: input.prompt_ref ? `${ctx.chatId}#${input.prompt_ref}` : null,
						outcome: input.outcome,
						step: input.step.trim(),
						hints_used: input.hints_used ?? 0,
						confidence: input.confidence ?? null,
					},
				});
			} else {
				if (typeof input.confidence !== "number") throw new Error("a self-rating needs a 1-5 confidence");
				ctx.append({ kind: "self_rating", rating: { sub_skill_id: id(input.sub_skill_id), label: input.label, confidence: input.confidence } });
			}
			return "Logged.";
		}),
	};
}

/** The module's materials as the composition root lists them. */
export interface StudyMaterials {
	dir: string;
	files: Record<string, string[]>;
}

function materialsSection(code: string, m: StudyMaterials | undefined): string {
	if (!m) return "";
	const folders = Object.entries(m.files);
	const total = folders.reduce((n, [, f]) => n + f.length, 0);
	if (total === 0) {
		return `

# Module materials (${code})
The module's materials folder (${m.dir}) is still empty; teach from the learner's own words and say once that adding lecture notes and past papers there would let you match the course.`;
	}
	const listing = folders
		.filter(([, f]) => f.length > 0)
		.map(([folder, f]) => `- ${folder}/ (${f.length}): ${f.slice(0, 40).join(", ")}${f.length > 40 ? ", …" : ""}`)
		.join("\n");
	return `

# Module materials (${code})
This module's own materials are in ${m.dir} — use them before looking anywhere else on the learner's machine:
${listing}
Before probing, read the spec and lecture notes for the topic so your questions match the course's scope, notation and sign conventions, and look at past papers for how the topic is examined. Paths are absolute: pass them to the file and PDF tools exactly as written here (join the folder and file name onto ${m.dir}).`;
}

/** The system-prompt section a module-tagged session adds. */
export function studyLogPrompt(ctx: Pick<StudyLogContext, "module" | "taxonomy"> & { materials?: StudyMaterials }): string {
	const ids = ctx.taxonomy.length
		? ctx.taxonomy
				.slice(0, 200)
				.map((t) => `- ${t.id}: ${t.label}${t.topic_id ? ` (topic ${t.topic_id})` : " (topic)"}`)
				.join("\n")
		: "(no taxonomy yet: pass null ids and a descriptive label; /make-papers maps labels to ids later)";
	return `

# Study log (module ${ctx.module})
This session belongs to module ${ctx.module}. Its practice papers are generated from what you log with the study_log tool, so log as you go, not at the end:
- kind "topic" whenever you start teaching a topic or sub-skill.
- kind "attempt" after every answer the learner gives to a question or problem: outcome is correct, method_gap (wrong principle or couldn't start), slip (right method, wrong algebra or arithmetic), needed_hint, or skipped; step names the exact step where it went right or wrong; hints_used counts hints; prompt_ref is the tool call id of the question.
- Before the learner attempts a question, ask how confident they are (1-5), unless the question already collects confidence; pass it as confidence. A confidence percentage converts as 0-29% = 1, 30-49% = 2, 50-69% = 3, 70-89% = 4, 90-100% = 5.
- kind "self_rating" when the learner rates their own confidence on a sub-skill.
Use the taxonomy ids below; when none fits, pass null and a descriptive label. Never invent an id.
Taxonomy:
${ids}${materialsSection(ctx.module, ctx.materials)}`;
}
