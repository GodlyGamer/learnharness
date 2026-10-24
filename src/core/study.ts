/**
 * The practice-paper pipeline's CONTRACT shapes (personal fork, 2026-10-24)
 * — browser-safe, pure. The files these describe are read and written by
 * .claude/skills/make-papers and mark-attempts as well as by this app, so
 * the shapes here mirror SETUP_PROMPT.md / the skills verbatim (snake_case
 * and all). Changing a field silently breaks the paper targeting; see the
 * study section of CLAUDE.md.
 */

/** How one attempt went (SETUP_PROMPT.md §3). method_gap = wrong principle
 *  or couldn't start; slip = right method, wrong algebra or arithmetic. */
export const STUDY_OUTCOMES = ["correct", "method_gap", "slip", "needed_hint", "skipped"] as const;
export type StudyOutcome = (typeof STUDY_OUTCOMES)[number];

export interface StudyTopic {
	topic_id: string | null;
	sub_skill_id: string | null;
	label: string;
}

export interface StudyEvent {
	time: string;
	sub_skill_id: string | null;
	label: string;
	/** Where in the session the attempt sits: the tool call id of the
	 *  question or problem it answers ("<chatId>#<toolCallId>"). */
	prompt_ref: string | null;
	outcome: StudyOutcome;
	/** The specific step, e.g. "set the limits of the inner integral". */
	step: string;
	hints_used: number;
	/** 1-5, asked before the attempt; null when not asked. */
	confidence: number | null;
}

export interface StudySelfRating {
	sub_skill_id: string | null;
	label: string;
	confidence: number;
}

/** study/modules/<CODE>/sessions/<session_id>.json — one per tutor session. */
export interface StudySessionLog {
	session_id: string;
	module: string;
	started: string;
	ended: string;
	topics_covered: StudyTopic[];
	events: StudyEvent[];
	self_ratings: StudySelfRating[];
}

export interface MarkingLost {
	code: string;
	type: "M" | "A" | "B";
	step: string;
	evidence: string;
	common_error: string | null;
}

export interface MarkingPart {
	paper: number | string;
	number: string;
	sub_skill_id: string | null;
	marks_available: number;
	marks_awarded: number;
	lost: MarkingLost[];
	attempted: boolean;
	unreadable: boolean;
	note: string;
}

/** study/modules/<CODE>/marking/<PAIR_ID>/marking.json. "approved" is set
 *  ONLY by the learner's approval in the app (POST …/marking/approve). */
export interface Marking {
	pair_id: string;
	status: "proposed" | "approved";
	marked_at: string;
	parts: MarkingPart[];
	totals?: Record<string, unknown>;
	approved_at?: string;
}

/** A module code: a short folder-safe id such as 1M1. */
export const MODULE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$/;
/** A folder-safe pair id (normally YYYY-MM-DD_<CODE>_<n>). */
export const PAIR_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export function isModuleCode(v: unknown): v is string {
	return typeof v === "string" && MODULE_CODE_RE.test(v);
}

export function isPairId(v: unknown): v is string {
	return typeof v === "string" && PAIR_ID_RE.test(v);
}

/** The app's confidence rail (0/30/50/70/90/100 %) on the setup's 1-5. */
export function confidenceToFive(percent: number): number {
	if (percent >= 90) return 5;
	if (percent >= 70) return 4;
	if (percent >= 50) return 3;
	if (percent >= 30) return 2;
	return 1;
}

export interface TaxonomySubSkill {
	id: string;
	label: string;
	topic_id: string | null;
}

/**
 * Every sub-skill in a taxonomy.json, whatever its exact nesting (the
 * file is written by /make-papers, so the app reads it defensively): an
 * object with a string id and label/name counts; a sub-skill's topic is
 * the nearest enclosing object that also has an id. Topics themselves are
 * returned too, flagged by a null topic_id.
 */
export function taxonomyEntries(taxonomy: unknown): TaxonomySubSkill[] {
	const out: TaxonomySubSkill[] = [];
	const seen = new Set<string>();
	const walk = (node: unknown, topic: string | null) => {
		if (Array.isArray(node)) {
			for (const item of node) walk(item, topic);
			return;
		}
		if (!node || typeof node !== "object") return;
		const rec = node as Record<string, unknown>;
		const id = typeof rec.id === "string" ? rec.id : undefined;
		const label = typeof rec.label === "string" ? rec.label : typeof rec.name === "string" ? rec.name : undefined;
		if (id && label && !seen.has(id)) {
			seen.add(id);
			out.push({ id, label, topic_id: topic });
		}
		for (const value of Object.values(rec)) walk(value, id ?? topic);
	};
	walk(taxonomy, null);
	return out;
}

/** Marks awarded and available across a marking's parts. */
export function markingTotals(m: Pick<Marking, "parts">): { awarded: number; available: number } {
	let awarded = 0;
	let available = 0;
	for (const p of m.parts) {
		awarded += Number(p.marks_awarded) || 0;
		available += Number(p.marks_available) || 0;
	}
	return { awarded, available };
}
