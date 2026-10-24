import type { MarkingPart } from "@/src/core";
import { readMarking, updateMarkingParts } from "@/src/server";

type Params = { params: Promise<{ code: string; pair: string }> };

export async function GET(_req: Request, { params }: Params) {
	const { code, pair } = await params;
	try {
		return Response.json({ marking: readMarking(code, pair) });
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
	}
}

/** The learner's line edits to a proposed marking (status unchanged). */
export async function PUT(req: Request, { params }: Params) {
	const { code, pair } = await params;
	const body = (await req.json().catch(() => ({}))) as { parts?: unknown };
	if (!Array.isArray(body.parts)) return Response.json({ error: "parts must be an array" }, { status: 400 });
	try {
		return Response.json({ marking: updateMarkingParts(code, pair, body.parts as MarkingPart[]) });
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
	}
}
