# Pleasant Soul Collective — Current AI Instructions

This repository has older guidance in some places. Treat the docs below as the source of truth:

- [../CLAUDE.md](../CLAUDE.md) for repo workflow, deploy notes, and session rules
- [../DESIGN.md](../DESIGN.md) for the visual and product language
- [../README.md](../README.md) for product intent
- [../tasks/lessons.md](../tasks/lessons.md) for durable corrections and known traps
- [../package.json](../package.json) for the real scripts

## Core expectations

- Put the artist-benefit check first: does this serve the creator?
- Prefer minimal, root-cause fixes over broad refactors or speculative abstractions.
- Do not add generic CRUD or growth-hacking patterns.
- Before changing UI, CSS, layout, or visual behavior, read [../DESIGN.md](../DESIGN.md) first.
- Prefer the current repo conventions and project docs over stale chat memory, old assumptions, or earlier instructions.

## Project-specific guardrails

- This is a cinematic, sovereignty-first music platform. The artist owns access, timing, rights, and sharing rules.
- Do not normalize artist control away or simplify the visual language to generic modern minimalism.
- Keep UI and architecture aligned with the console/vault aesthetic; avoid “plain SaaS” patterns.
- For deploy, infra, or “what is the real process?” questions, prefer the repo’s current notes over older guidance.

## Verification before claiming done

- Use the actual scripts in [../package.json](../package.json): build, test, and preflight checks when relevant.
- If the task touches visual design or platform behavior, verify the change against the current product intent and design rules.
- If requirements are unclear or a change could affect multiple systems, stop and clarify scope before patching.

## If there is a conflict

When docs disagree, prefer the current, repo-authoritative files: [../CLAUDE.md](../CLAUDE.md), [../DESIGN.md](../DESIGN.md), and [../tasks/lessons.md](../tasks/lessons.md). This file is intentionally short and should not replace the working project docs.
