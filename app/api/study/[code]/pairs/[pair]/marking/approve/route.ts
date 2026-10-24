import { approveMarking, stores, syncPairToGraph } from "@/src/server";

/** The learner's approval — the ONLY path that sets "status": "approved".
 *  The approved results then attach to the questions' graph nodes. */
export async function POST(_req: Request, { params }: { params: Promise<{ code: string; pair: string }> }) {
	const { code, pair } = await params;
	try {
		const marking = approveMarking(code, pair);
		syncPairToGraph(stores.graphStore, code, pair);
		return Response.json({ marking });
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
	}
}
