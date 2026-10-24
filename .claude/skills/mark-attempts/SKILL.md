---
name: mark-attempts
description: Mark photos of my handwritten attempts at a generated paper pair against its mark schemes and write a proposed marking for me to approve. Run as /mark-attempts <CODE> <PAIR_ID>; usually started headless by the tutor app.
---

Mark my attempts at paper pair $ARGUMENTS (module code, then pair id) and write study/modules/<CODE>/marking/<PAIR_ID>/marking.json with "status": "proposed".

Inputs: the photos in attempts/<PAIR_ID>/ (named Q<n>_p<page>.jpg), plus papers/<PAIR_ID>/questions.json and the two mark-scheme PDFs. questions.json gives each part's mark codes, sub_skill_id, answer and common errors.

This usually runs headless with nobody to answer, so record anything unclear in the file instead of asking.

Marking rules:
- Mark as a strict examiner. Award M only where the right principle is visibly applied, A only after its M, dM and ft exactly as the scheme states. In a "show that", missing steps lose their marks. Generous marking hides the method gaps the next papers exist to fix.
- If you can't read the working, set "unreadable": true and describe what you couldn't read. Award and deduct nothing for that part; I'll settle it when I approve.
- A part with no working gets "attempted": false. It loses all its marks.
- For every lost mark, name the step, transcribe the line of my working where it went wrong, and attach the matching common_error if one fits.

marking.json:
{ "pair_id", "status": "proposed", "marked_at",
  "parts": [ { "paper", "number", "sub_skill_id", "marks_available", "marks_awarded",
               "lost": [ { "code", "type": "M" | "A" | "B", "step", "evidence", "common_error" } ],
               "attempted", "unreadable", "note" } ],
  "totals": { "paper1_by_block", "paper2_by_question", "M_lost", "A_lost" } }

Never set "status" to "approved"; only my approval in the app does that.
