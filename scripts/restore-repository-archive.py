"""Verify or reconstruct the complete project from Git plus the LFS payload."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def safe_target(root, name):
    rel = PurePosixPath(name)
    if rel.is_absolute() or '..' in rel.parts or '\\' in name or ':' in name:
        raise ValueError('Unsafe archived path')
    result = root.joinpath(*rel.parts).resolve()
    if root.resolve() not in result.parents:
        raise ValueError('Path escapes destination')
    return result

def checksum(stream):
    h = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        h.update(chunk)
    return h.hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--verify-only', action='store_true')
    parser.add_argument('--destination', type=Path)
    args = parser.parse_args()
    if not args.verify_only and args.destination is None:
        parser.error('Use --verify-only or --destination NEW_EMPTY_FOLDER')
    manifest = json.loads((ROOT / 'project-archive/manifest.json').read_text(encoding='utf-8'))
    if manifest['format'] != 'dnd-tcgfy-workspace-sha256-v1':
        raise ValueError('Unsupported archive format')
    payload = ROOT / 'project-archive' / manifest['payload']['file']
    with payload.open('rb') as stream:
        if checksum(stream) != manifest['payload']['sha256']:
            raise ValueError('LFS payload missing or checksum mismatch; run git lfs pull')
    destination = args.destination.resolve() if args.destination else None
    if destination and destination.exists() and any(destination.iterdir()):
        raise ValueError('Destination must be empty; existing projects are never overwritten')
    with zipfile.ZipFile(payload) as archive:
        for sha, size in manifest['objects'].items():
            member = archive.getinfo('objects/' + sha)
            if member.file_size != size:
                raise ValueError('Archived object size mismatch')
            with archive.open(member) as stream:
                if checksum(stream) != sha:
                    raise ValueError('Archived object checksum mismatch')
        for entry in manifest['archivedFiles']:
            target = safe_target(destination or ROOT, entry['path'])
            if entry['sha256'] not in manifest['objects'] or entry['bytes'] != manifest['objects'][entry['sha256']]:
                raise ValueError('Invalid manifest object reference')
            if destination:
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open('objects/' + entry['sha256']) as source, target.open('wb') as output:
                    shutil.copyfileobj(source, output)
        for entry in manifest['gitFiles']:
            target = safe_target(destination or ROOT, entry['path'])
            # Read canonical blobs: Windows checkout CRLF conversion cannot alter
            # the source preserved by the repository history.
            result = subprocess.run(['git', 'cat-file', 'blob', entry['gitBlob']], cwd=ROOT, stdout=subprocess.PIPE, check=True)
            if destination:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(result.stdout)
    print(json.dumps({'verifiedObjects': len(manifest['objects']), 'archivedPaths': len(manifest['archivedFiles']), 'gitPaths': len(manifest['gitFiles']), 'restored': str(destination) if destination else None}))

if __name__ == '__main__':
    main()
