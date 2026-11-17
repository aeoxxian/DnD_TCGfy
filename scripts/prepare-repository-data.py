"""Read-only capture of approved application data for the GitHub handoff."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile

root = Path(__file__).resolve().parents[1]
source = Path(os.environ['APPDATA']) / 'DnD TCG-fy'
target = root / 'repository-data' / 'user-data'
if target.exists():
    raise SystemExit('Refusing to replace an existing repository data snapshot')
staging = Path(tempfile.mkdtemp(prefix='github-data-', dir=str(root / 'artifacts')))
database = source / 'data/app.sqlite3'
wal = database.with_name(database.name + '-wal')

def stamp(path):
    try:
        stat = path.stat()
        return stat.st_size, stat.st_mtime_ns
    except FileNotFoundError:
        return None

snapshot = None
for attempt in range(5):
    before = (stamp(database), stamp(wal))
    folder = staging / str(attempt)
    folder.mkdir()
    candidate = folder / 'app.sqlite3'
    shutil.copyfile(database, candidate)
    if before[1] is not None:
        try:
            shutil.copyfile(wal, candidate.with_name(candidate.name + '-wal'))
        except FileNotFoundError:
            continue
    if before == (stamp(database), stamp(wal)):
        snapshot = candidate
        break
if snapshot is None:
    raise SystemExit('Application data is changing; close the app and retry')

target.mkdir(parents=True)
(target / 'data').mkdir()
reader = sqlite3.connect(str(snapshot))
writer = sqlite3.connect(str(target / 'data/app.sqlite3'))
reader.backup(writer)
writer.execute('PRAGMA journal_mode=DELETE')
writer.close()
reader.close()
# Copy all non-browser data, including originals not currently referenced.
for directory in ['assets', 'backups', 'cache']:
    if (source / directory).exists():
        shutil.copytree(source / directory, target / directory)
for path in (source / 'data').iterdir():
    if path.is_file() and path.name not in ['app.sqlite3', 'app.sqlite3-wal', 'app.sqlite3-shm']:
        shutil.copy2(path, target / 'data' / path.name)

db = sqlite3.connect((target / 'data/app.sqlite3').as_uri() + '?mode=ro&immutable=1', uri=True)
assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
assert db.execute('PRAGMA foreign_key_check').fetchall() == []
missing = []
for relative_path, expected in db.execute('SELECT relative_path,sha256 FROM assets'):
    asset = (target / relative_path).resolve()
    if target.resolve() not in asset.parents:
        raise ValueError('Unsafe managed asset path')
    if not asset.exists():
        missing.append(relative_path)
    else:
        assert hashlib.sha256(asset.read_bytes()).hexdigest() == expected
counts = {}
for table in ['card_definitions', 'character_profiles', 'decks', 'resource_templates', 'resource_instances', 'card_bindings', 'play_events']:
    counts[table] = db.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0]
version = db.execute('PRAGMA user_version').fetchone()[0]
db.close()
files = []
for path in sorted(target.rglob('*')):
    if path.is_file():
        files.append({'path': path.relative_to(target).as_posix(), 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
manifest = {'schemaVersion': version, 'sqliteIntegrity': 'ok', 'foreignKeyViolations': 0, 'counts': counts, 'files': files, 'alreadyMissingInSource': missing, 'sourcePolicy': 'Source DB/WAL and assets only read; standalone DB generated from isolated copies; browser sessions excluded.'}
(root / 'repository-data/manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'copiedFiles': len(files), 'counts': counts, 'missingSourceAssets': len(missing)}))
