# Complete repository export

This repository preserves the P4-C 0.5.2 project and its existing Git history.
Checks and exact coverage are recorded in [export verification](REPOSITORY_EXPORT_VERIFICATION.md).
The owner explicitly requested publication of the saved library and play state.
The destination, https://github.com/aeoxxian/DnD_TCGfy, is public.

## Contents

- Normal Git files: application source, tests, documentation, review screenshots,
  original handoff ZIP, and the saved-data snapshot in `repository-data/`.
- `repository-data/user-data/`: a consistent SQLite v6 backup, original card
  assets, existing backups, and thumbnail cache. The manifest records hashes,
  integrity checks, and record counts. Browser sessions are excluded.
- `distribution/DnD-TCGfy-0.5.2-win-x64.zip`: the complete runnable Windows folder.
- `project-archive/workspace-payload.zip`: lossless, SHA-256-deduplicated copies
  of otherwise ignored workspace files, including dependency/tool source,
  generated builds, test databases, screenshots, and test images.
- `project-archive/manifest.json`: maps every preserved workspace path to its
  Git blob or archived object and lists excluded runtime/credential paths.

Both large ZIPs use Git LFS. Install Git LFS before cloning:

```powershell
git lfs install
git clone https://github.com/aeoxxian/DnD_TCGfy.git
cd DnD_TCGfy
git lfs pull
python scripts/restore-repository-archive.py --verify-only
```

For development use `npm ci` and `npm run dev` (Node.js 24 required).
Extract the distribution ZIP and launch `DnD TCG-fy.exe` to run the packaged
application; keep all extracted files together.

## Reconstruct the captured workspace

```powershell
python scripts/restore-repository-archive.py --destination C:\Temp\DnD-TCGfy-restored
```

The destination must be new or empty. The tool verifies the payload and every
unique object, then reconstructs original paths. Ordinary Git files are restored
from canonical Git blobs, independent of checkout line-ending conversion.
Git history remains in the cloned repository, not in this reconstructed folder.
The manifest/payload and distribution ZIP themselves remain in the clone.

## Restore the saved library and play state

The checked-in snapshot is archival: do not point the application directly at
its database. Close the app, back up your current `%APPDATA%\DnD TCG-fy` folder,
then copy the contents of `repository-data/user-data/` into a separate empty
user-data folder. For the default location, move the old user-data folder aside
before copying rather than merging two libraries. Keep the relative `assets/`
and `data/` paths intact. Never copy a snapshot over a running database.

The snapshot includes 17 card definitions (including archived cards), 5
characters, 5 decks, 14 resource templates, 15 resource instances, 6 card
bindings, and 102 play events. All 17 original asset files are preserved.
SQLite integrity and foreign-key checks passed; no referenced images are missing.
Source AppData images and database were not modified during capture.

## Exclusions and security

Browser profiles/sessions, authentication material, Git internals, and
rebuildable non-code/non-image caches are excluded. Git history is uploaded
normally. All project code and image files, including ignored test and tool
files, are retained through normal Git files or the deduplicated archive.
The export is a snapshot, not automatic synchronization of future AppData edits.
The ZIP manifest documents exact coverage and SHA-256 checksums.

This export does not change application behavior, apply a new visual theme,
or start P5. P4-C validation remains recorded in `P4_C_REVIEW.md`.
