/**
 * "This computer" setup (personal fork, 2026-10-24) — the desktop app's
 * first-launch screen and Settings → This computer.
 *
 *   GET              → the whole picture: whether setup is still needed, the
 *                      workspace folder, Claude, Gemini, the paper tools and
 *                      any sign-in or install in progress (spawns the Claude
 *                      binary for its status — call it once, then poll ?live).
 *   GET ?live=1      → only the in-progress jobs (cheap; for polling).
 *   POST {action}    → claude-login | claude-code {code} | gemini-install |
 *                      gemini-login | paper-tools-install | finish
 */

import {
	claudeLoginState,
	claudeStatus,
	finishMachineSetup,
	geminiInstallState,
	geminiLoginState,
	geminiStatus,
	installPaperTools,
	machineSetupNeeded,
	paperToolsInstallState,
	paperToolsStatus,
	startClaudeLogin,
	startGeminiInstall,
	startGeminiLogin,
	submitClaudeCode,
	workspaceInfo,
} from "@/src/server";

export const dynamic = "force-dynamic";

const live = () => ({
	claudeLogin: claudeLoginState(),
	geminiInstall: geminiInstallState(),
	geminiLogin: geminiLoginState(),
	paperToolsInstall: paperToolsInstallState(),
});

export async function GET(req: Request) {
	if (new URL(req.url).searchParams.get("live")) return Response.json(live());
	return Response.json({
		needed: machineSetupNeeded(),
		workspace: workspaceInfo(),
		claude: claudeStatus(),
		gemini: geminiStatus(),
		paperTools: paperToolsStatus(),
		...live(),
	});
}

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { action?: string; code?: string };
	try {
		switch (body.action) {
			case "claude-login":
				return Response.json(startClaudeLogin());
			case "claude-code":
				if (!body.code?.trim()) return Response.json({ error: "no code given" }, { status: 400 });
				submitClaudeCode(body.code);
				return Response.json({ ok: true });
			case "gemini-install":
				return Response.json(startGeminiInstall());
			case "gemini-login":
				return Response.json(startGeminiLogin());
			case "paper-tools-install":
				return Response.json(installPaperTools());
			case "finish":
				finishMachineSetup();
				return Response.json({ ok: true });
			default:
				return Response.json({ error: `unknown action ${body.action}` }, { status: 400 });
		}
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
	}
}
