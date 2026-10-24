import { pairInfo, startStudyJob } from "@/src/server";

/** Run /mark-attempts <CODE> <PAIR> headless; it writes a PROPOSED marking. */
export async function POST(_req: Request, { params }: { params: Promise<{ code: string; pair: string }> }) {
	const { code, pair } = await params;
	try {
		if (pairInfo(code, pair).attempts.length === 0) throw new Error("Upload photos of your attempts first.");
		return Response.json({ job: startStudyJob("mark-attempts", code, { pair }) });
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
	}
}
