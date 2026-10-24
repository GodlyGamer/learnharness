Set up this repo so a practice-paper pipeline can learn from my tutor sessions. Four pieces: a study folder layout, session logging in the tutor, photo hand-in for marking, and a LaTeX toolchain on this Windows machine. The paper generator itself already exists as .claude/skills/make-papers, .claude/skills/mark-attempts and .claude/agents/*.md; your job is the plumbing those files read from and write to.

<context>
This repo is my tutor app: Claude teaches me university modules (I'm a first-year MEng Mechanical Engineering student) and topics show as linked nodes in a graph. /make-papers generates practice papers from what the tutor logged; /mark-attempts marks photos of my handwritten attempts. Both depend on the file formats below, so treat them as a contract: if the tutor writes a different shape, the papers stop targeting my weaknesses without any error.
</context>

<steps>
1. Read the repo first: stack, where sessions run, how the node graph is stored, how topics are named. Report what you found in five lines before changing anything, and build everything below in the existing stack.

2. Create this layout under study/ (if another root fits the repo better, say so and use it):
   study/modules/<CODE>/
     materials/past_papers/  materials/mark_schemes/  materials/lecture_notes/  materials/spec/  materials/problem_sheets/
     taxonomy.json            topic and sub-skill ids; written by /make-papers, read by the tutor
     sessions/                one JSON file per tutor session
     papers/<PAIR_ID>/        generated PDFs, questions.json, verification.md
     attempts/<PAIR_ID>/      my uploaded photos
     marking/<PAIR_ID>/marking.json
   <CODE> is the module code, e.g. 1M1. <PAIR_ID> is YYYY-MM-DD_<CODE>_<n>.

3. Make the tutor write one file per session to sessions/, in this shape:
   { "session_id", "module", "started", "ended",
     "topics_covered": [ { "topic_id", "sub_skill_id", "label" } ],
     "events": [ { "time", "sub_skill_id", "label", "prompt_ref",
                   "outcome": "correct" | "method_gap" | "slip" | "needed_hint" | "skipped",
                   "step": "the specific step, e.g. 'set the limits of the inner integral'",
                   "hints_used": 0, "confidence": 1-5 or null } ],
     "self_ratings": [ { "sub_skill_id", "label", "confidence": 1-5 } ] }
   Take ids from study/modules/<CODE>/taxonomy.json when it exists. When it doesn't, or no id fits, write null and keep a descriptive label: /make-papers maps labels to ids later, and a guessed id would misfile the evidence silently.
   method_gap = wrong principle or couldn't start; slip = right method, wrong algebra or arithmetic. Before I attempt a question, the tutor asks my confidence (1-5), because confidence compared with outcome is how overconfidence gets caught.
   Append events as they happen rather than at session end, so a crash keeps the data.

4. Add a hand-in screen: I pick module and paper pair, upload photos, and they save to attempts/<PAIR_ID>/ as Q<n>_p<page>.jpg. The app then runs marking headless: claude -p "/mark-attempts <CODE> <PAIR_ID>" (check claude --help for the current flags, and limit file access to study/). When marking.json appears with "status": "proposed", show it per question (marks awarded, M and A marks lost, the step flagged, anything marked unreadable), let me edit any line, and on my approval set "status": "approved". Only my approval sets that value.

5. Import papers/<PAIR_ID>/questions.json into the graph: each question becomes a node linked to its topic node by topic_id, and approved marking results attach to the question node.

6. Install the toolchain with winget/pip: Python with sympy, numpy, pymupdf; MiKTeX; Strawberry Perl (latexmk needs Perl under MiKTeX). Compile a one-page test using the exam class, amsmath, siunitx and tikz with latexmk -pdf -interaction=nonstopmode -halt-on-error and confirm the PDF opens. If an install fails, stop and give me the command and the error in one line rather than switching to another tool.

7. Add a short section to CLAUDE.md describing the study/ layout, the session JSON and the marking.json status rule, so later Claude Code sessions don't change the contract by accident.
</steps>

If the repo already logs something close to this, adapt it and tell me what differs instead of running two logging systems. Finish with: what you built, one session file produced by a short fake session, and anything you couldn't wire.
