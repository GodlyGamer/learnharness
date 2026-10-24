import { isModuleCode } from "@/src/core";
import { ensureModule, listModuleCodes, listStudyJobs, moduleInfo, stores, studyRoot, syncPairToGraph } from "@/src/server";

/** The Practice papers section's state: every module (materials, session
 *  logs, paper pairs with their attempts and marking) plus the running
 *  jobs. Pairs made outside the app (Claude Code's /make-papers) join the
 *  knowledge graph here the first time they're seen; the import is
 *  idempotent (a marker file per pair). */
export async function GET() {
	const modules = listModuleCodes().map((code) => {
		const info = moduleInfo(code);
		for (const pair of info.pairs) {
			try {
				syncPairToGraph(stores.graphStore, code, pair.id);
			} catch {
				// A malformed questions.json shouldn't hide the module.
			}
		}
		return info;
	});
	return Response.json({ root: studyRoot(), modules, jobs: listStudyJobs() });
}

/** Create a module's folder tree. */
export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { code?: unknown };
	if (!isModuleCode(body.code)) {
		return Response.json({ error: "Module codes are letters, digits, - or _, e.g. 1M1." }, { status: 400 });
	}
	ensureModule(body.code);
	return Response.json({ module: moduleInfo(body.code) });
}
