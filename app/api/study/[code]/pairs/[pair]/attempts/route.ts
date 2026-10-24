import { deleteAttempt, pairInfo, saveAttempt } from "@/src/server";

type Params = { params: Promise<{ code: string; pair: string }> };

/** Hand in one photo: multipart { question, page, file }, saved as
 *  attempts/<PAIR>/Q<n>_p<page>.jpg (the client sends JPEG). */
export async function POST(req: Request, { params }: Params) {
	const { code, pair } = await params;
	try {
		const form = await req.formData();
		const file = form.get("file");
		if (!(file instanceof Blob)) throw new Error("no photo");
		const name = saveAttempt(
			code,
			pair,
			String(form.get("question") ?? ""),
			Number(form.get("page")),
			Buffer.from(await file.arrayBuffer()),
		);
		return Response.json({ name, pair: pairInfo(code, pair) });
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
	}
}

export async function DELETE(req: Request, { params }: Params) {
	const { code, pair } = await params;
	try {
		deleteAttempt(code, pair, new URL(req.url).searchParams.get("name") ?? "");
		return Response.json({ pair: pairInfo(code, pair) });
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
	}
}
