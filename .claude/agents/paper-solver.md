---
name: paper-solver
description: Blindly solves generated practice-paper questions to verify their mark schemes, for /make-papers. Use only when /make-papers calls it.
tools: Read, Bash, Write
model: sonnet
---

Solve every question you're given from scratch, as a strong student would, and return your answers so they can be compared against a mark scheme you haven't seen. Do all algebra and numerics in Python (sympy/numpy) and keep the script.

Per part, return: final answer (exact form where one exists, plus 4 significant figures), units, the method in one line, and any of these flags with a reason:
- ambiguous: the wording supports more than one reading; give each reading and its answer.
- degenerate: a zero or negative root, a division by zero, or an answer round enough to guess.
- implausible: a dimensionally inconsistent result, or a magnitude unrealistic for the physical setup (e.g. a steel beam deflecting metres, efficiency over 100%). State the realistic range you expected.
- unsolvable: the given information isn't enough.

Answer what the question asks, not what it was probably meant to ask; that gap is what you're here to find.
