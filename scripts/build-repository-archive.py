"""Preserve ignored workspace files losslessly, deduplicated by SHA-256.

Authored/tracked files remain normal Git files. Browser sessions and credential
files are excluded. All other code and image files are included, even in caches.
"""
import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'project-archive'
IMAGES = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico', '.bmp', '.avif'}
CODE = {'.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.ps1', '.css', '.html', '.json', '.cmd', '.sh', '.c', '.h', '.cpp'}
SECRET = re.compile(rb'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])|sk-proj-[A-Za-z0-9_-]{40,})')

def digest(path, scan=True):
    h = hashlib.sha256()
    tail = b''
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            if scan and SECRET.search(tail + chunk):
                raise ValueError('Possible credential requires review: ' + str(path.relative_to(ROOT)))
            h.update(chunk)
            tail = chunk[-1024:]
    return h.hexdigest()

def tracked():
    raw = subprocess.check_output(['git', 'ls-files', '-s', '-z'], cwd=ROOT)
    entries = []
    for item in raw.split(b'\0'):
        if not item:
            continue
        metadata, name = item.split(b'\t', 1)
        mode, blob, stage = metadata.decode().split()
        path = name.decode('utf-8')
        if path.startswith(('project-archive/', 'distribution/')):
            continue
        if stage != '0':
            raise ValueError('Resolve unmerged Git files before export')
        actual = ROOT / path
        if actual.is_file():
            digest(actual)
        entries.append({'path': path, 'gitBlob': blob, 'mode': mode})
    return entries

def refresh_git(manifest):
    manifest['gitFiles'] = tracked()
    manifest['gitBaseRevision'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    return manifest

def exclusion(path):
    parts = path.parts
    low = [p.lower() for p in parts]
    if '.git' in low:
        return 'git-internals-preserved-by-history'
    if parts[0] in ['project-archive', 'distribution'] or parts[:2] == ('artifacts', 'repository-export'):
        return 'export-output-not-recursive'
    if parts[0] == 'artifacts' and 'chromium' in low:
        return 'browser-session-and-runtime-cache'
    if path.name.lower() in ['.git-credentials', 'credentials', 'id_rsa', 'id_ed25519'] or path.name == '.env' or path.name.startswith('.env.') and not path.name.endswith(('.example', '.sample')):
        return 'credential-file'
    # Keep every actual code/image file, even when it resides in a tool cache.
    if path.suffix.lower() not in IMAGES | CODE:
        if parts[:2] == ('.tools', 'npm-cache') or '__pycache__' in low or '.cache' in low:
            return 'rebuildable-runtime-cache'
        if path.suffix.lower() in ['.pem', '.key', '.pfx', '.p12']:
            return 'key-material'
    return None

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--refresh-git-only', action='store_true')
    args = parser.parse_args()
    OUT.mkdir(exist_ok=True)
    index = OUT / 'manifest.json'
    if args.refresh_git_only:
        manifest = refresh_git(json.loads(index.read_text(encoding='utf-8')))
        index.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
        print('Refreshed Git-file coverage:', len(manifest['gitFiles']))
        return
    if (OUT / 'workspace-payload.zip').exists():
        raise SystemExit('Refusing to overwrite an existing payload')
    git_entries = tracked()
    git_paths = {e['path'] for e in git_entries}
    stage = ROOT / 'artifacts/repository-export'
    stage.mkdir(parents=True, exist_ok=True)
    temporary = stage / 'workspace-payload.zip'
    files, excluded, objects = [], [], {}
    counts = Counter()
    # A failed capture closes a valid partial ZIP. Reuse its objects, while
    # recapturing the complete path map and validating every source file again.
    # The restore verifier checks all reused object bytes before publication.
    if temporary.exists():
        with zipfile.ZipFile(temporary) as partial:
            for member in partial.infolist():
                if not re.fullmatch(r'objects/[0-9a-f]{64}', member.filename):
                    raise ValueError('Unexpected partial archive entry')
                objects[member.filename.split('/')[1]] = member.file_size
        print('Reusing', len(objects), 'objects from interrupted capture', flush=True)
    with zipfile.ZipFile(temporary, 'a' if temporary.exists() else 'w', zipfile.ZIP_DEFLATED, allowZip64=True, compresslevel=6) as archive:
        for folder, dirs, names in os.walk(ROOT, followlinks=False):
            rel_dir = Path(folder).relative_to(ROOT)
            dirs[:] = sorted(d for d in dirs if d != '.git' and not (rel_dir == Path('.') and d in ['project-archive', 'distribution']))
            for name in sorted(names):
                path = Path(folder) / name
                rel = path.relative_to(ROOT)
                key = rel.as_posix()
                if key in git_paths:
                    continue
                why = exclusion(rel)
                if why:
                    counts['excluded:' + why] += 1
                    excluded.append({'path': key, 'reason': why})
                    continue
                if path.is_symlink() and ROOT not in path.resolve().parents:
                    raise ValueError('External symlink needs review: ' + key)
                if path.name == '.npmrc' and re.search(r'(?i)(?:_auth|token|password)\s*=', path.read_text(encoding='utf-8', errors='ignore')):
                    excluded.append({'path': key, 'reason': 'credential-configuration'})
                    continue
                stat = path.stat()
                sha = digest(path)
                if sha not in objects:
                    archive.write(path, 'objects/' + sha)
                    objects[sha] = stat.st_size
                if stat.st_size != path.stat().st_size or stat.st_mtime_ns != path.stat().st_mtime_ns:
                    raise ValueError('Workspace file changed during capture: ' + key)
                files.append({'path': key, 'sha256': sha, 'bytes': stat.st_size})
                counts['files'] += 1
                counts['bytes'] += stat.st_size
                if path.suffix.lower() in IMAGES:
                    counts['images'] += 1
                if path.suffix.lower() in CODE:
                    counts['codeFiles'] += 1
                if counts['files'] % 2000 == 0:
                    print('Captured', counts['files'], 'files;', len(objects), 'unique objects', flush=True)
    payload = OUT / 'workspace-payload.zip'
    temporary.replace(payload)
    manifest = {'format': 'dnd-tcgfy-workspace-sha256-v1', 'capturedAtUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'gitBaseRevision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(), 'payload': {'file': payload.name, 'bytes': payload.stat().st_size, 'sha256': digest(payload, False)}, 'gitFiles': git_entries, 'archivedFiles': files, 'objects': objects, 'excludedFiles': excluded, 'summary': dict(counts)}
    index.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'archivedFiles': len(files), 'uniqueObjects': len(objects), 'payloadMiB': round(payload.stat().st_size / 1048576, 1), 'images': counts['images'], 'codeFiles': counts['codeFiles']}), flush=True)

if __name__ == '__main__':
    main()
