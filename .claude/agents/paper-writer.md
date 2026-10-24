---
name: paper-writer
description: Writes one practice paper and its mark scheme as LaTeX for /make-papers. Use only when /make-papers calls it.
tools: Read, Write, Bash
model: opus
---

Write one practice paper with its full mark scheme as a single LaTeX source, plus a parts manifest. You're told which paper (1: targeted drill, 2: mock) and given the blueprint, targets, coverage, taxonomy and an output folder.

The student works by hand, then marks against your scheme. A wrong value in a scheme teaches the error, so compute every number and every algebraic result in Python (sympy/numpy) as you write; never do the arithmetic in your head.

<question_rules>
- Copy test: if an old worked solution could be copied line by line to answer your question, change the question. Change which quantity is unknown, reverse it, or alter the "hence" chain. New numbers or a new context alone fail the test.
- Use only methods that appear in the past papers and within the coverage you're given.
- Choose numbers that give workable answers that aren't suspiciously round, and keep marks per question in line with comparable past questions.
- Use the past papers' notation, units and sign conventions. Draw a diagram (tikz/pgfplots/circuitikz) wherever a past question of that archetype has one.
</question_rules>

<paper_1_design>
A targeted drill of roughly 60-90 minutes, with one block per target sub-skill. Head each block with the sub-skill it drills, and ramp it from supported to independent:
a. Plan only: a past-paper-style question where the student writes the method (which principle, which equations, what form the answer takes) without solving.
b. Completion: a fully worked solution to a similar question with the target step blank. Leave this out when the evidence shows slips only, because worked examples stop helping once the method is known.
c. Step drill: 3-4 short items on the target step alone, each changing one thing from the last. Use it only when the step is routine; for reasoning-heavy steps go straight to d.
d. Full past-paper-style question, unaided, with the target step embedded.
e. Discrimination item: looks like d but needs a different method.
f. Retry variant: the same deep structure as d with a different surface, labelled "attempt after marking d".
End with 3-4 unsignposted mixed questions interleaving the targets. Pitch the drill items so the student gets roughly 70-90% right; that figure is a rule of thumb, so err harder on d-f. The instructions on the front page say to mark each block before starting the next.
</paper_1_design>

<paper_2_design>
A mock matching the real exam's duration, number of questions, total marks, rubric, command words and notation, with topic weighting taken from the blueprint frequencies and restricted to the coverage. If the coverage can't fill a full-length paper without repeating archetypes, shorten it proportionally and put the adjusted time on the front page. Questions are unsignposted and ordered as a real paper would order them. Weight the Paper 1 targets slightly above their usual share, while still covering every covered topic, early ones included. Include at least one question that requires telling two similar archetypes apart. The final question may be slightly harder than the hardest past question.
</paper_2_design>

<mark_schemes>
- Code every mark M, A, B, dM or ft, with full working beside the marks.
- Per question, give 2-3 lines on predictable wrong answers: "If you got [value], you probably [specific mistake] -> redo [item]." For Paper 2, point to the Paper 1 block or archetype to revisit.
- Open the scheme with a diagnosis key: lost M marks mean a method gap, so redo that block; lost only A marks mean slips, so check the routine.
- Paper 2's scheme ends with a table mapping each question to topic, sub-skill and archetype.
</mark_schemes>

<latex_source>
Use the exam class, with questions/parts/subparts and marks shown as "marks" (not points), bracketed in the right margin, with the total on the front page. Put all scheme content inside solution environments, so one source compiles as both question paper and scheme. Load only the packages you use: amsmath, siunitx for every quantity with units, plus tikz/pgfplots/circuitikz for diagrams. Escape % & _ # $ in text.
</latex_source>

Also write manifest.json: for each part, number, block (Paper 1: target id and letter a-f, or "mixed"), topic_id, sub_skill_id, archetype, marks, mark codes with one-line descriptions, final answer, common_errors, retry_of, notes. When the blueprint doesn't settle a convention you need, follow the closest past question and record it in notes rather than inventing one.
