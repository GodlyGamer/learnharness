/**
 * Paper questions into the knowledge graph (SETUP_PROMPT.md §5; personal
 * fork, 2026-10-24). The graph stores propositions and reasoning chains,
 * so a paper lands as:
 *   - a TOPIC node per taxonomy topic_id ("1M1 topic: Beam bending"),
 *   - a QUESTION node per part ("1M1 P1 Q3b"),
 *   - a chain question → topic (the link by topic_id),
 *   - and, once a marking is APPROVED, its result appended to the question
 *     node as a phrasing line (node lines merge by id, so the result rides
 *     on the same node).
 * Ids are deterministic, so re-importing merges instead of duplicating; a
 * marker file per pair records what was already imported. Provenance is a
 * notes-style source ("src_study_…") pointing at the pair's questions.json.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { GraphNode } from "../core/contracts/graph.ts";
import type { GraphStore } from "../core/ports.ts";
import { readMarking, readPairQuestions, readTaxonomy, moduleDir } from "./study.ts";

const hash = (s: string) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);

export const topicNodeId = (code: string, topicId: string) => `n_study_${hash(`topic:${code}:${topicId}`)}`;
export const questionNodeId = (code: string, pair: string, paper: string, number: string) =>
	`n_study_${hash(`q:${code}:${pair}:${paper}:${number}`)}`;
const sourceId = (code: string, pair: string) => `src_study_${hash(`${code}:${pair}`)}`;

interface ImportMarker {
	questionsImportedAt?: string;
	markingApprovedAt?: string;
}

function markerFile(code: string, pair: string): string {
	return path.join(moduleDir(code), "papers", pair, ".graph-import.json");
}

function readMarker(code: string, pair: string): ImportMarker {
	try {
		return JSON.parse(fs.readFileSync(markerFile(code, pair), "utf-8")) as ImportMarker;
	} catch {
		return {};
	}
}

function writeMarker(code: string, pair: string, marker: ImportMarker): void {
	fs.writeFileSync(markerFile(code, pair), JSON.stringify(marker, null, "\t"), "utf-8");
}

/**
 * Import a pair's questions.json (once) and its approved marking (once
 * per approval). Returns what was written; a pair without questions.json
 * imports nothing.
 */
export function syncPairToGraph(
	graph: Pick<GraphStore, "appendNode" | "appendChain" | "upsertSource" | "readNodes">,
	code: string,
	pair: string,
	now = new Date().toISOString(),
): { questions: number; marked: number } {
	const questions = readPairQuestions(code, pair);
	if (questions.length === 0) return { questions: 0, marked: 0 };
	const marker = readMarker(code, pair);
	const src = sourceId(code, pair);
	const provenance = (messageId: string) => [{ chatId: src, messageId }];
	let imported = 0;
	let marked = 0;

	if (!marker.questionsImportedAt) {
		graph.upsertSource({
			id: src,
			filePath: path.join(moduleDir(code), "papers", pair, "questions.json"),
			importedAt: now,
		});
		const labels = new Map(readTaxonomy(code).map((t) => [t.id, t.label]));
		const existing = new Set(graph.readNodes().map((n) => n.id));
		for (const q of questions) {
			const qId = questionNodeId(code, pair, String(q.paper), q.number);
			const skill = q.sub_skill_id ? (labels.get(q.sub_skill_id) ?? q.sub_skill_id) : "an untagged skill";
			const node: GraphNode = {
				id: qId,
				name: `${code} P${q.paper} Q${q.number}`,
				statement: `Practice question ${q.number} of Paper ${q.paper} in pair ${pair} (${code}) drills ${skill}${
					q.marks !== null ? `, for ${q.marks} marks` : ""
				}.`,
				aliases: [],
				createdAt: now,
				provenance: provenance(`Q${q.number}`),
			};
			graph.appendNode(node);
			imported++;
			if (!q.topic_id) continue;
			const tId = topicNodeId(code, q.topic_id);
			if (!existing.has(tId)) {
				const label = labels.get(q.topic_id) ?? q.topic_id;
				graph.appendNode({
					id: tId,
					name: label,
					statement: `${code} module topic: ${label} (taxonomy id ${q.topic_id}).`,
					aliases: [],
					createdAt: now,
					provenance: provenance("taxonomy"),
				});
				existing.add(tId);
			}
			graph.appendChain({
				id: `arg_study_${hash(`${qId}->${tId}`)}`,
				premises: [qId],
				conclusion: tId,
				provenance: provenance(`Q${q.number}`),
				createdAt: now,
			});
		}
		marker.questionsImportedAt = now;
	}

	const marking = readMarking(code, pair);
	if (marking?.status === "approved" && marking.approved_at && marking.approved_at !== marker.markingApprovedAt) {
		for (const part of marking.parts) {
			const lost = part.lost.map((l) => `${l.code} at "${l.step}"`).join("; ");
			const result = `Marked ${marking.approved_at.slice(0, 10)}: ${part.marks_awarded}/${part.marks_available}${
				part.attempted === false ? " (not attempted)" : ""
			}${lost ? `; lost ${lost}` : ""}`;
			graph.appendNode({
				id: questionNodeId(code, pair, String(part.paper), String(part.number)),
				name: `${code} P${part.paper} Q${part.number}`,
				statement: "",
				aliases: [result],
				createdAt: now,
				provenance: provenance(`Q${part.number}`),
			});
			marked++;
		}
		marker.markingApprovedAt = marking.approved_at;
	}

	if (imported || marked) writeMarker(code, pair, marker);
	return { questions: imported, marked };
}
