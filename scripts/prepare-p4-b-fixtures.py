"""Copy registered images for QA; never write to the user's SQLite or assets."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import shutil
import tempfile

source = Path(sys.argv[1] if len(sys.argv) > 1 else Path(os.environ['APPDATA']) / 'DnD TCG-fy').resolve()
target = Path('artifacts/p4-b-input').resolve()
if source == target or source in target.parents:
    raise ValueError('Fixture output must be separate from user data')

target.mkdir(parents=True, exist_ok=True)
# Never let SQLite request SHM/journal access beside the original database.
# Copy DB+WAL only while their size/mtime stay unchanged across the copy.
database = source / 'data/app.sqlite3'
wal = database.with_name(database.name + '-wal')
def stamp(path):
    try:
        stat = path.stat()
        return stat.st_size, stat.st_mtime_ns
    except FileNotFoundError:
        return None

snapshot = None
for attempt in range(3):
    before = (stamp(database), stamp(wal))
    folder = Path(tempfile.mkdtemp(prefix='read-snapshot-', dir=str(target)))
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
    raise ValueError('Source database is changing; close the app and retry')

connection = sqlite3.connect(snapshot.as_uri() + '?mode=ro', uri=True)
try:
    if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise ValueError('Copied database integrity check failed')
    rows = connection.execute('SELECT c.name,a.relative_path,a.sha256 FROM card_definitions c JOIN assets a ON a.id=c.image_asset_id WHERE c.archived_at IS NULL ORDER BY c.created_at').fetchall()
finally:
    connection.close()

manifest = []
for name, relative_path, expected_hash in rows[:200]:
    path = (source / relative_path).resolve()
    if source not in path.parents:
        raise ValueError('Unsafe asset path')
    if path.suffix.lower() not in ['.png', '.jpg', '.jpeg', '.webp']:
        continue
    if not path.is_file():
        print('Skipped missing registered image')
        continue
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected_hash:
        raise ValueError('Registered original hash mismatch')
    filename = 'registered-{:02}{}'.format(len(manifest) + 1, path.suffix.lower())
    (target / filename).write_bytes(data)
    manifest.append({'file': filename, 'name': name, 'sha256': expected_hash})

if not manifest:
    raise ValueError('No readable registered images; provide a fixture manifest separately')
(target / 'registered.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print('Prepared {} registered image copies; queried isolated DB/WAL copies only'.format(len(manifest)))
