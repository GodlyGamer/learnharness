import { startStudyJob } from "@/src/server";

/** Run /make-papers <CODE> [topics] headless on the subscription. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
	const { code } = await params;
	const body = (await req.json().catch(() => ({}))) as { topics?: unknown };
	try {
		const job = startStudyJob("make-papers", code, { topics: typeof body.topics === "string" ? body.topics : undefined });
		return Response.json({ job });
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
	}
}
