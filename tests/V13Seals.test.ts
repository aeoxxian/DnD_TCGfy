import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve('src/assets/playmat');
const css = readFileSync(resolve('src/theme-playmat.css'), 'utf8');

describe('v1.3 Phase 3 UI-P3 (memo 5) · a Use seal per theme', () => {
  it('적갈 가죽 keeps its wax seal; the other themes point at their own seal file', () => {
    expect(css).toContain("--seal: url('./assets/playmat/wax-seal.png');");
    for (const [theme, file] of [['ebony', 'seal-ebony.svg'], ['verdant', 'seal-felt.svg'], ['abyss', 'seal-arcane.svg']]) {
      expect(existsSync(resolve(dir, file)), file).toBe(true);
      expect(css).toMatch(new RegExp(`\\.app\\.playmat\\[data-theme=${theme}\\] \\{ --seal: url\\('\\./assets/playmat/${file.replace('.', '\\.')}'\\);`));
    }
  });
  it('the seals are self-contained vectors (no links, images or scripts), carry their id, and 아케인 블루 has no metal colours', () => {
    for (const name of ['seal-ebony', 'seal-felt', 'seal-arcane']) {
      const svg = readFileSync(resolve(dir, `${name}.svg`), 'utf8');
      expect(svg.startsWith(`<svg id="${name}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"`)).toBe(true);
      expect(svg).not.toMatch(/<image|<script|href=|https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
    }
    // Silver/brass/bronze gradients are named for their metal in the generator; the arcane seal uses none of them.
    expect(readFileSync(resolve(dir, 'seal-arcane.svg'), 'utf8')).not.toMatch(/silver|brass|bronze|gold/);
  });
});
