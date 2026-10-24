import { PapersView } from "@/components/papers/papers-view";

/** Practice papers (personal fork, 2026-10-24): the practice-paper
 *  pipeline's home — modules, generated pairs, hand-in and marking. */
export default async function PapersPage({ searchParams }: { searchParams: Promise<{ module?: string }> }) {
	const { module } = await searchParams;
	return <PapersView initialModule={module ?? null} />;
}
