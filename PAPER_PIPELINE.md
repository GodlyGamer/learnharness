# Practice-paper pipeline: install

1. Unzip into the root of your tutor app repo, so the `.claude/` folder merges with the repo's own `.claude/` (if it has one). `SETUP_PROMPT.md` and this README sit at the repo root.
2. Open Claude Code in the repo and say: `Read SETUP_PROMPT.md and carry it out.`
3. After setup, put a module's files in `study/modules/<CODE>/materials/`, run some tutor sessions, then run `/make-papers <CODE>`.
4. Hand in attempts through the app's upload screen; approve the marking it proposes before the next `/make-papers` run.

Files:
- `SETUP_PROMPT.md`: one-time wiring (folders, session logging, hand-in, LaTeX on Windows).
- `.claude/skills/make-papers/SKILL.md`: generates the paper pair.
- `.claude/skills/mark-attempts/SKILL.md`: marks photos of your attempts.
- `.claude/agents/`: paper-analyst, paper-writer (Opus); paper-solver, syllabus-checker, style-reviewer (Sonnet).
