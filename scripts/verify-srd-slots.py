"""Compare shipped numeric slot presets with the official 2014 SRD PDF.

Download SRD_CC_v5.1.pdf to artifacts/references first. Requires pypdf, which may
be installed into .tools/pdf-reader without changing application dependencies.
This reads the PDF directly, independently of the TypeScript preset loader.
"""
import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path('.tools/pdf-reader').resolve()))
from pypdf import PdfReader  # noqa: E402

path = Path('artifacts/references/SRD_CC_v5.1.pdf')
reader = PdfReader(path)
definitions = json.loads(Path('src/data/classes-2014.json').read_text(encoding='utf-8'))
fixture = json.loads(Path('tests/fixtures/srd51-slots.json').read_text(encoding='utf-8'))
assert hashlib.sha256(path.read_bytes()).hexdigest() == fixture['sha256']
checked = 0
for name, page in fixture['pages'].items():
    size = 5 if name in ('paladin', 'ranger') else 9
    text = reader.pages[page - 1].extract_text(extraction_mode='layout')
    text = text.replace('\r', '').replace('\xa0', ' ').replace('\t', '')
    rows = {}
    for line in text.split('\n'):
        match = re.match(r'^\s*(\d+)(?:st|nd|rd|th)\s', line)
        if not match:
            continue
        cells = line.split()[-size:]
        assert len(cells) == size and all(cell.isdigit() or cell in ('\x8a', '—', '–', '̶') for cell in cells)
        rows[match[1]] = {str(i + 1): int(cell) for i, cell in enumerate(cells) if cell.isdigit() and int(cell) > 0}
    assert len(rows) == 20
    assert rows == fixture['classes'][name]
    shipped = next(value for value in definitions['classes'][name]['resources'] if value['key'] == 'spell_slots')
    assert rows == shipped['slotCapacityByClassLevel'], name
    checked += len(rows)
print(f'PASS: {checked} class-level slot rows match the official SRD 5.1 PDF and independent fixtures.')
