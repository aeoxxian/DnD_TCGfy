# Repository export verification

Export baseline: P4-C 0.5.2, commit `e1dbb38`. Destination:
https://github.com/aeoxxian/DnD_TCGfy (public). The owner explicitly authorized
including the complete saved library and play state.

## Saved data

- 40 preserved files: 17 original assets, 17 thumbnails, 5 migration backups,
  and one standalone SQLite database. Every file's SHA-256 was checked.
- SQLite schema v6; integrity check `ok`; zero foreign-key violations and zero
  missing referenced images. WAL contents were folded into an isolated backup;
  no WAL/SHM sidecars are needed in the published snapshot.
- 17 card definitions, 5 characters, 5 decks, 14 resource templates, 15 resource
  instances, 6 card bindings, and 102 play events. These include existing
  archived-card state and stored history rather than a regenerated sample set.
- The source AppData database/WAL and images were read, never modified.

## Windows distribution

The complete `win-unpacked` folder was archived and all 120 ZIP entries were
compared with source-file SHA-256 values. ZIP SHA-256:
`300df157848c9600308b308b579f6016db6780bf3120bee602fbe8a88846d05f`.
Its `resources/app.asar` matches the previously built and launched P4-C version:
`26c1cbd78a627e0f6124004c1461c7a3b14fd36ba0ccb48b6aacb6c1e1e0fd5e`.
No new Windows build or EXE launch is claimed for this archive-only change.

## Checks

- Workspace coverage: zero missing non-excluded paths; 13,193 image paths and
  15,112 code/data paths (recognized source/script/JSON extensions). These
  counts include duplicated test fixtures and tool/dependency files.
- LFS payload: 36,637 original paths, 21,471 unique SHA-256 objects,
  5,162,377,741 original bytes, 671,751,687 compressed bytes (640.6 MiB).
  SHA-256: `d1de60c14c412ad3e6a57960e54ddcf9cc4816fcdfc61c32bd8cd32ebe5a1d2c`.

- ESLint: passed, no warnings. TypeScript `--noEmit`: passed.
- Full isolated reconstruction: all 21,471 archived objects verified, all
  36,637 archived paths and 332 ordinary Git files restored successfully.
- `node scripts/test.mjs` executed in that reconstructed workspace:
  **408 tests passed in 17 files**, exit code 0 (21.66 seconds).
- 477 historical Git blobs scanned for supported credential-token patterns;
  none detected. Newly exported files are scanned during capture as well.
  An AWS-like substring inside Electron's embedded base64 data was inspected
  and rejected as a false positive; token boundaries prevent that match.
- Restore utility: verification, deduplicated byte-identical restoration,
  existing-destination refusal, payload checksum rejection, path traversal
  rejection, and object-size rejection all passed. Four additional unsafe-path
  inputs were rejected.
- Existing application and Windows behavior validation is documented in
  `P4_C_REVIEW.md`; this export does not change application behavior.

The archive manifest records exact file coverage and explicit exclusions.
Browser sessions, credentials, Git internals, recursive export outputs, and
rebuildable non-code/non-image caches are excluded. All project source and
images are retained through ordinary Git or lossless LFS payload objects.
