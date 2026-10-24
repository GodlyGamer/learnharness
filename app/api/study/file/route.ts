import fs from "node:fs";
import path from "node:path";
import { resolveStudyFile } from "@/src/server";

const TYPES: Record<string, string> = {
	".pdf": "application/pdf",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".md": "text/markdown; charset=utf-8",
	".json": "application/json",
};

/** Serve one file from the study tree (PDFs, attempt photos,
 *  verification.md); anything outside study/ is a 404. */
export async function GET(req: Request) {
	const rel = new URL(req.url).searchParams.get("path") ?? "";
	const file = resolveStudyFile(rel);
	const type = file ? TYPES[path.extname(file).toLowerCase()] : undefined;
	if (!file || !type) return new Response("Not found", { status: 404 });
	return new Response(fs.readFileSync(file), {
		headers: {
			"content-type": type,
			"cache-control": "no-store",
			"content-disposition": `inline; filename="${path.basename(file)}"`,
		},
	});
}
