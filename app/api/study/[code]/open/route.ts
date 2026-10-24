import { spawn } from "node:child_process";
import path from "node:path";
import { moduleDir, moduleExists } from "@/src/server";

/** Open a module's folder (or one of its subfolders) in the OS file
 *  manager, so materials can be dropped straight in. Local app only. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
	const { code } = await params;
	if (!moduleExists(code)) return Response.json({ error: `no module ${code}` }, { status: 404 });
	const body = (await req.json().catch(() => ({}))) as { sub?: unknown };
	const sub = typeof body.sub === "string" && /^[a-z_/]+$/.test(body.sub) ? body.sub : "";
	const dir = path.join(moduleDir(code), sub);
	const cmd = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
	spawn(cmd, [dir], { detached: true, stdio: "ignore" }).unref();
	return Response.json({ opened: dir });
}
