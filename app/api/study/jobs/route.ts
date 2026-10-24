import { cancelStudyJob, listStudyJobs } from "@/src/server";

export async function GET() {
	return Response.json({ jobs: listStudyJobs() });
}

/** Cancel a running paper or marking job: DELETE ?id=<job id>. */
export async function DELETE(req: Request) {
	cancelStudyJob(new URL(req.url).searchParams.get("id") ?? "");
	return Response.json({ jobs: listStudyJobs() });
}
