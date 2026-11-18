# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

DnD TCG-fy is an offline-first Windows 10/11 x64 Electron app that shows D&D player actions as a TCG-style hand of selectable cards, with a generic resource engine (spell slots, counters, points) that cards spend from. The UI text and most documentation are in Korean.

**Read `AGENTS.md` first.** Its hard constraints are binding: no scope creep into dice, combat, turns or networking. Never alter user card art. Only a confirmed `Use` spends resources. Never reset user data. Record stack or scope changes in `DECISIONS.md` before implementing them. Do not claim Windows/EXE steps were tested unless they actually ran. The product contract is `SPEC.md` and the domain contract is `DATA_SCHEMA.md`, extended by the phase supplements `DATA_SCHEMA_P1…P4C.md`, `DATA_SCHEMA_TRASH.md`, `DATA_SCHEMA_V1_1.md` and `DATA_SCHEMA_V1_2.md`. Work followed the phases P0→P5 in `IMPLEMENTATION_PLAN.md` (P5 = 0.6.0 is done). v1.1 usability work followed `V1_1_PLAN.md` one phase at a time with the user's approval after each phase; all four phases passed the final review and shipped as 1.1.0 (`V1_1_RELEASE.md`). v1.2 follows `V1_2_PLAN.md` the same way (Phase 1 → user approval → Phase 2 …; Phase 3 theme redesign needs the user's screenshot review). Do not start the next phase, new features or a next version without the user's approval.

## Commands

Requires Node **24.x** (`node:sqlite` is used directly) and npm 11+. Do not omit optional dependencies, because sharp needs its Windows native binaries. If `npm` is missing, use `.\scripts\bootstrap-npm.ps1 <args>`, which downloads npm into `.tools/`.

```powershell
npm ci
npm run dev          # Vite on 127.0.0.1:5173 (strictPort) + Electron; main/preload changes need a restart
npm run lint         # eslint, --max-warnings 0
npm run typecheck    # tsc --noEmit
npm test             # vitest run via scripts/test.mjs (sets TMP to artifacts/vitest-temp)
npm test -- tests/resources.test.ts          # single file
npm test -- tests/resources.test.ts -t "undo" # single test by name
npm run build        # tsc + vite build -> dist/, esbuild electron/*.ts -> dist-electron/*.cjs
npm start            # run the built bundle
npm run pack:win     # build + electron-builder --dir -> release/win-unpacked/DnD TCG-fy.exe
npm run dist:win     # NSIS installer
```

Quality gate before moving on: `lint`, `typecheck` and `test` must all pass.

E2E scripts drive a real Electron window with Playwright. Each run isolates its data in `artifacts/p1-e2e-*/user-data` through `DND_TCG_TEST_USER_DATA`, which must be an absolute path.
- `npm run test:e2e` or `node scripts/e2e.mjs --dev [--from-v5]` covers the main scenario. `--from-vN` seeds an older schema to exercise the migrations.
- To test the packaged EXE, set `$env:DND_TCG_EXECUTABLE` to `release\win-unpacked\DnD TCG-fy.exe` and drop `--dev`.
- Phase suites are `scripts/p4-a-e2e.mjs`, `p4-b-e2e.mjs` (run `prepare-p4-b-fixtures.mjs` first) and `p4-c-e2e.mjs`. `scripts/v11-p1-e2e.mjs` checks the v1.1 Phase 1 filter bar (`--dev`, built bundle or `DND_TCG_EXECUTABLE`; it covers 3 window sizes × 100/125/150% scaling), and `scripts/v11-p2-e2e.mjs` checks Phase 2 (main-screen registration, selection bar, recent-history clearing, including a restart), and `scripts/v11-p3-e2e.mjs` checks Phase 3 (re-click enlargement, drag vs click, unusable-card overlay, motion, tilt option, reduced motion, image files unchanged), and `scripts/v11-p4-e2e.mjs` checks Phase 4 (spell slot colours per kind/level/character with restart and restore, and the table cursors per element type with hotspots at 100/125/150% and the system-cursor option). `scripts/v12-p1-e2e.mjs` checks v1.2 Phase 1 (scope follows the character selector, whole-library deck building, resource creation inside card registration with cancel/failure/duplicate cases).
- Dev-mode E2E uses port 5173, so never run two at once.

## Architecture

There are three layers, and the renderer never touches the filesystem or the database:

- **`src/shared/`** holds pure, framework-free domain code that both processes import. `contracts.ts` defines the zod runtime schemas, the `IPC` channel map, the `Result<T>` type (`{ok,value}|{ok,error}`) and the `DesktopBridge` interface. `resource-engine.ts` and `resources.ts` compute costs, recovery and plans. `casting.ts` handles upcast/downcast slot validation, and it is the *only* place class or casting rules branch. `use-rules.ts`, `bulk.ts`, `trash.ts` and `library.ts` hold filtering and other pure logic. `presets.ts` reads `src/data/classes-2014.json`, the 2014 SRD class resource tables, which `tests/fixtures/srd51-slots.json` verifies.
- **`electron/`** is the main process. `main.ts` sets the userData path, the single-instance lock, permission denial, the request allowlist and the `app://` protocol. The protocol serves the bundle plus asset images by ID, and `security.ts` defines the CSP and URL rules. Every IPC channel is registered through `safeHandler`, which rejects any sender that is not the main window's trusted main frame. It wraps results in `Result`, surfaces only `UserInputError` messages to users and maps `ZodError` to a generic message. Domain stores each own one area on a shared `AppStore` (`store.ts`, a `DatabaseSync` SQLite connection). The stores are `library-store`, `registration-store`, `resource-store`, `class-store`, `edit-store` (bulk edits and restore), `trash-store` and `asset-cleanup`, plus `assets.ts` (image import, originals and thumbnails via sharp).
- **`electron/preload.ts`** exposes a frozen `window.desktop` bridge with one function per IPC channel. **`src/`** is the React 19 renderer. `App.tsx` loads `getBootstrap()` and the components in `src/components/` call `window.desktop.*`. CSS is layered as `styles.css` → `p4-a.css` → `p4-b.css` → `p4-c.css` → `theme-playmat.css`. The last file is the play-mat UI and wins over the earlier layers. Its rules are scoped to `.app.playmat`, and base control styles use `:where()` so component rules win. Themes are `data-theme` on `.app` (`oxblood`, `ebony`, `verdant`, `abyss`). They swap the CSS variables for leather colors and metal (`--m*`/`--p*`, `--frame-img`, `--coin`, `--logo`). Material images live in `src/assets/playmat/`, and their Python generators are in `scripts/design/`. Change the look in `theme-playmat.css`, not in the earlier layers.

Layout: the selected card (`SelectedCardPanel`, still `.detail-panel`) is rendered *inside* the board as the IN PLAY slot plus a parchment page. The hand row is `DeckPile | hand | UsedPile` (`src/components/Appearance.tsx`). E2E scripts depend on the class names `.use-button`, `.card-use`, `.cards-area`, `.description-content` and `.deck-label`, and on the accessible names of buttons and meters, so keep them stable. Since v1.2 there are no 전체 카드/활성 덱 buttons: a selected character shows its active deck and the 전체 라이브러리 entry shows every card (`viewScope` in App is derived; an old saved "character + library" state is read as the deck view). Cards are put into decks from the whole library through 관리 → 덱에 넣기·빼기 (`DeckMembership`); E2E uses `putInDeck`/`showWholeLibrary` in `scripts/navigation-helpers.mjs`. The extra filters are a native `popover="auto"` (`#extra-filters-panel`, anchored to `.extra-filters-toggle`) in a fixed-height `.board-top` row; E2E opens and closes it only through `openExtraFilters`/`closeExtraFilters` in `scripts/navigation-helpers.mjs`.

Backup and restore (`electron/backup.ts`, UI `src/components/BackupManager.tsx`, contract `src/shared/backup.ts`):
- **ZIP format:** `manifest.json` (per-file bytes and SHA-256), `data/app.sqlite3` (a `VACUUM INTO` snapshot) and `assets/*`.
- **Inspection:** `inspect()` validates the whole archive (allow-listed paths, size and ratio limits, hashes, DB integrity and schema) and stages it under `restore/staging/<token>`.
- **Replace restore:** writes `restore/pending.json` and relaunches the app. `applyPendingRestore()` runs in `main.ts` *before* `AppStore` opens the DB; it moves the current `data`, `assets` and thumbnails to `backups/replaced-*` (never deletes them) and rolls back on failure.
- **Copy restore:** `importCopies()` adds only the backup's active cards, images and tags, with new IDs.
- **Auto snapshots:** `autoSnapshot()` runs at start-up into `backups/auto` and prunes only its own `app-YYYYMMDD-HHMMSS.sqlite3` files (keeps 14).
- **Paths:** file paths come only from main-process dialogs, never from the renderer.
- **Testing:** E2E sets `DND_TCG_TEST_NO_RELAUNCH=1` so a replace restore exits instead of relaunching.

P5 checks: `node scripts/p5-e2e.mjs` covers offline play, a hard kill, export, restore into a new profile and copy import; it also runs against a packaged exe via `DND_TCG_EXECUTABLE`. `node scripts/p5-installer-check.mjs <older-setup> <new-setup>` does a silent install, upgrade and uninstall, and refuses to run if the app is already installed.

Appearance (theme and card backs) is `Settings.appearance`, validated by `appearanceSchema`. `AppStore` stores it under its own `appearance` settings key and checks that custom card-back asset ids exist. Pure helpers are in `src/shared/appearance.ts`. v1.1 adds `Settings.historyViews` (key `history_view`): a per-character "hidden through" mark for the recent-actions list (`src/shared/history-view.ts`); it never touches play events or Undo. `Settings.effects` (key `effects`, `{cardTilt}`) holds the enlarged-card tilt option. `Settings.slotColors` (key `slot_colors`) holds per-character spell slot gem colours (`src/shared/slot-colors.ts`, editor `SlotColorEditor` in 자원 관리); filled slot gems are a masked diamond painted with `--slot-gem`. Cursors: the user approved draft A; `node scripts/design/cursors.mjs --apply a` writes `src/assets/cursors/*.png` (1×/1.5×/2×) and `hotspots.json`, and `theme-playmat.css` applies them only under `.app.custom-cursor` (removed by `effects.systemCursor`). Text fields keep `cursor: text`, disabled controls `not-allowed`; hotspots are even 1× coordinates so they stay whole pixels at 1.5×/2×. The Phase 4 E2E checks them through Electron's `cursor-changed` event. Registration can draft a new counter (`NewResourceDialog`, opened from the use-rule resource picker as a second modal after the registration `<form>`); the draft travels as `initialRules.newResources` and `RegistrationStore` creates it with `create_resource` inside the registration transaction, then rewires the bindings (`src/shared/resource-drafts.ts`). Card usability (`src/shared/usability.ts`, computed by `cardUsability` in `CardResources.tsx`) drives the card-back overlay on unusable hand cards; clicking a selected card opens `ImageLightbox`, which animates from `previewOrigin` unless motion is reduced.

Adding an IPC operation touches four places: `IPC` and the types in `contracts.ts`, the bridge in `preload.ts`, a `safeHandler` that validates input with zod in `main.ts`, and the store method.

### Persistence invariants

- The SQLite schema is versioned through `PRAGMA user_version` plus the `schema_migrations` table. `electron/migrations.ts` holds `SCHEMA_VERSION` (currently 6). `store.ts` first inspects an existing DB **read-only** and refuses future versions, unknown or unversioned tables, mismatched migration history and failed `quick_check`. It never resets the DB. Before migrating it writes a consistent backup to `backups/`, then applies the migrations in a transaction. A schema change needs a new migration entry, a version bump, a `DATA_SCHEMA_*.md` note and regression tests in `tests/store.test.ts`. Prefer optional JSON-contract fields over new columns when they are enough.
- Card definitions, character profiles, resource templates, per-character resource instances, per-character cost overrides and play events are separate tables. Resource mutations carry a request UUID and an expected character revision, so duplicate submissions are idempotent and stale ones are rejected. Multi-resource spends are all-or-nothing. Undo walks events in reverse order, and settings changes act as Undo boundaries. Class or level changes have their own snapshot Undo. Bulk edits and trash keep separate restore histories from resource Undo.
- Imported images are byte-for-byte copies stored in `assets/<uuid>.<ext>`. Thumbnails in `cache/thumbnails/` can be regenerated. Image files are only cleaned up after a permanent delete, and only when they are unshared and traceable to the deleted card. Locked files are queued and retried at startup.
- userData lives in `%APPDATA%\DnD TCG-fy` when packaged and in `%APPDATA%\DnD TCG-fy Development` in dev. Tests and E2E must never touch either location.

### Tests

The Vitest environment defaults to `node`. UI tests opt in with a `// @vitest-environment jsdom` header and mock `window.desktop`. Store tests create real SQLite fixtures under `artifacts/unit-data/`. `artifacts/`, `dist*/`, `release/` and `.tools/` are gitignored build or test output.

## Repository extras

`repository-data/` (a saved user-data snapshot), `distribution/`, `project-archive/` and `archive/` are preservation exports, not source. The large ZIPs are stored in Git LFS, and `REPOSITORY_IMPORT.md` describes how to restore them. Do not modify them as part of normal development.
