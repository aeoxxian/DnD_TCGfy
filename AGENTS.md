# Instructions for Codex — DnD TCG-fy

## Mission
Build and maintain a Windows 10/11 x64 offline-first Electron desktop application that turns D&D player actions into a TCG-like selectable card hand. Keep the card-selection experience central. Treat `SPEC.md` as the product contract and `DATA_SCHEMA.md` as the domain contract.

## Hard constraints
1. Do NOT expand scope into dice rolling, combat automation, turn order, damage rules, enemy management, networking, or cloud accounts.
2. Do NOT generate or alter card artwork automatically. Keep uploaded image files byte-for-byte intact; display with `contain`.
3. Keep card definitions, character profiles, resource templates, live resource instances, and play events separate.
4. Base classes and homebrew use the **same** resource engine. Express rules through data, not class-name condition branches, except for casting-mode validation.
5. Only a confirmed `Use` operation spends resources. All multi-resource changes must be atomic and undoable.
6. Never delete or reset user data as a side effect of a build, migration, upgrade, or debugging action.
7. Use secure Electron defaults, tightly scoped IPC, runtime schema validation, and local-only operations.
8. Support 2014 single-class rules and homebrew; don't invent unverified feature tables or claim every subclass is automated.
9. Add/update automated tests for resource spending, rest recovery, upcasting, homebrew downcasting, undo, and persistence.
10. Explain any change of stack/scope in `DECISIONS.md` before implementation; be transparent about steps not tested on Windows.

## Working order
P0 → P1 → P2 → P3 → P4 → P5 from `IMPLEMENTATION_PLAN.md`. Ship a runnable milestone at each stage. Prefer functionality and persistence correctness over visual polish; then refine card interactions without hiding card text.

## Per-milestone report
Provide: implemented features; files changed; how to run; commands/tests executed and outcomes; screenshots where feasible; known issues; next milestone. Do not report a `.exe` as tested unless it was actually built and launched.

## Initial task
Read all four handoff documents, initialize the project at P0, create a reproducible local dev setup, and continue to P1 only after P0 validation. Use temporary sample card data if no assets are supplied; never regenerate the user's original art.
