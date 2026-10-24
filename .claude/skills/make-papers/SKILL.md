---
name: make-papers
description: Generate a practice pair for one module (Paper 1 targeted drill, Paper 2 mock, each with a mark scheme) as LaTeX PDFs plus an app import file, targeted from tutor session logs and approved markings. Run as /make-papers <CODE> [topics].
---

Turn the materials for module $ARGUMENTS into two new practice papers built on deliberate-practice principles, each with its own mark scheme: Paper 1, a targeted drill, and Paper 2, a mock under exam conditions. The first word of the arguments is the module code; any words after it are topics I want the papers to cover.

<context>
I'm a first-year MEng Mechanical Engineering student. I use these papers to find the exact steps I lose marks on, drill them, and check the fix holds under exam conditions. Everything lives in study/modules/<CODE>/ (layout in CLAUDE.md). My tutor app logs each teaching session to sessions/; I mark attempts through the app and approve the result in marking/.
</context>

<what_good_looks_like>
- Every question traces to a pattern in the past papers: same syllabus, notation, command words, mark density and difficulty. Someone who knows the module couldn't tell Paper 2 from a real paper by style, yet no question can be answered by copying an old worked solution.
- Every answer in the mark schemes is correct: the writer's answer and two independent blind solvers agree.
- Paper 1's targets come from evidence of what I actually get wrong, and after marking it I know which step I fail on and which item to redo.
</what_good_looks_like>

<likeliest_failures>
In order of damage:
1. A wrong answer or unworkable numbers in a mark scheme. A practice paper with a wrong scheme teaches the error.
2. Evidence misfiled: a tutor log, a marking and the blueprint naming the same step differently, so the targeting ignores what I got wrong. Every comparison goes through taxonomy ids.
3. Past questions reskinned with new numbers only, or textbook questions that drift off the syllabus.
4. Mark-scheme text leaking into a question paper, or LaTeX appearing in chat.
</likeliest_failures>

<inputs>
Read in full: everything in materials/, every file in sessions/, and marking/*/marking.json files with "status": "approved". Skip proposed markings: I haven't checked them, and a misread photo would skew the targets. If a page is unreadable, list it as [UNREADABLE: file, page] and work from the rest. With one past paper, or no mark schemes, carry on, infer mark splits from the marks shown, and say so.
</inputs>

<coverage>
If I named topics, cover those. Otherwise cover the topics in topics_covered across the session logs, because a question on something the tutor hasn't taught yet measures nothing. If there are no session logs and I named no topics, stop and ask me which topics to cover; this is the one question worth stopping for.
</coverage>

<learner_model>
Rebuild it from the raw logs every run and write it to learner_model.md for me to read. Never read an old learner_model.md as input, so one bad run can't carry into the next.
For each sub_skill_id within coverage, rank evidence:
1. M marks lost, or parts not attempted, in approved markings: method gaps under test conditions.
2. method_gap or needed_hint events in sessions.
3. Overconfidence: confidence 4-5 on attempts that failed.
4. A marks lost or slips only.
5. No evidence: the sub-skills carrying the most marks in past papers.
Newer evidence outranks older. A sub-skill I got full marks on in both the d and f items of the latest Paper 1 drops out of the targets.
learner_model.md has one row per sub-skill: evidence counts by type, rank, date last seen, and one line saying what I get wrong.
</learner_model>

<pipeline>
Run these stages with the Agent tool, giving each subagent only the inputs listed. A solver that sees the intended answer tends to agree with it, which is why the inputs are kept apart.

0. Taxonomy (you). If taxonomy.json is missing, build it from spec, lecture notes and past papers: topics, each split into sub-skills that are steps rather than topics ("set the limits when integrating over a region", not "integration"), with short ids like int-region-limits. If it exists, map null-id session labels to existing ids and add an entry only when nothing fits. Never rename or delete an id, because the tutor and old markings use them. Write it back.
1. paper-analyst. Input: past papers, past mark schemes, taxonomy. Output: blueprint.md.
2. Targeting (you). Pick 3-4 Paper 1 targets from the learner model, within coverage, each a taxonomy sub-skill.
3. paper-writer, two instances in parallel, one for Paper 1 and one for Paper 2. Input: blueprint, targets, coverage, taxonomy, output folder papers/<PAIR_ID>/source/.
4. Fact checks, in parallel. First extract question text only from the question-paper sources, with every solution environment removed:
   a. paper-solver, two instances: one with model opus, one with model sonnet. Input: question text only. Different models make different mistakes, so their agreement carries more weight than two runs of one model.
   b. syllabus-checker. Input: question text, lecture notes, spec, problem sheets, past papers.
   c. style-reviewer, blind pass. Input: for each Paper 2 question, an unlabelled shuffled set of that question plus two real past questions on the same topic. Keep the answer key yourself.
   d. style-reviewer, rules pass. Input: both papers with schemes, past papers, past mark schemes.
5. Reconcile (you). An answer ships only when the writer's scheme and both solvers agree: symbolically equal or within 0.1% (check it in sympy). Fix mismatches, ambiguous wording, degenerate cases, values a solver flags as physically implausible, any method the syllabus checker can't cite, and any tell the blind reviewer used to spot the generated question. Re-run only the checks a fix touches. After two failed fixes on one question, replace it: a shorter paper with correct answers beats a full one with an error.
6. Write verification.md: one row per part with writer answer, solver A, solver B, agreed, syllabus citation, blind-test result and fixes made.
7. Compile per <latex>.
8. Write questions.json from the writers' manifests: pair_id, module, and per part: paper, number, block, topic_id, sub_skill_id, archetype, marks, mark codes with one-line descriptions, final answer, common_errors, retry_of.
</pipeline>

<latex>
LaTeX is the build step only. I use the PDFs, so put no LaTeX in chat.
- Compile each paper source twice: plain as the question paper, and with the answers class option as the mark scheme. Use latexmk -pdf -interaction=nonstopmode -halt-on-error; a single pdflatex pass leaves the totals as "??".
- Before compiling, search the source for unescaped %, which silently deletes the rest of its line.
- After each compile, check: exit code 0; no log lines starting "!"; no "??" or rerun warnings; no overfull boxes over about 5pt.
- Use PyMuPDF to extract each question paper's text and confirm no mark-scheme text is in it, and to render every page to PNG. Look at each page for diagrams, page breaks and answer space.
- If the toolchain is missing, say so in one line and ask before falling back to a non-LaTeX PDF.
Name the files <CODE>_Paper1.pdf, <CODE>_Paper1_MarkScheme.pdf, <CODE>_Paper2.pdf and <CODE>_Paper2_MarkScheme.pdf, in papers/<PAIR_ID>/.
</latex>

<reply>
Reply in under 150 words:
1. Targets: one line per Paper 1 block, giving the sub-skill and the evidence file it came from.
2. Verification: how many answers triple-agreed, and how many questions were fixed or replaced.
3. How to use: work through Paper 1 and mark it block by block; sit Paper 2 timed in one go, ideally a day or more later; upload attempts in the app.
4. Anything unreadable, inferred, out of coverage or skipped, one line each.
</reply>
