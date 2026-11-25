import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve('src/theme-playmat.css'), 'utf8');
/** The body of the last `@media <query> { … }` block with that exact query. */
function media(query: string): string {
  const start = css.lastIndexOf(`@media ${query} {`);
  expect(start, query).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error(`unclosed ${query}`);
}

describe('v1.3 Phase 3 UI-P4 · the board fits short windows', () => {
  it('561–680 px tall windows get a shorter card page, the compact seal and a smaller hand reserve', () => {
    const band = media('(min-height: 561px) and (max-height: 680px)');
    expect(band).toContain('.board-center > .detail-panel { flex-basis: clamp(170px, 31dvh, 200px); }');
    expect(band).toMatch(/\.use-button \{ width: 60px; height: 60px;/);
    expect(band).toMatch(/--hand-width: clamp\(64px, min\(calc\(100cqw \/ 5\.6\), calc\(\(100cqh - 48px\) \/ 1\.458\)\), 250px\)/);
    // The board frame keeps its ornament: the band changes padding, never the border image.
    expect(band).not.toMatch(/border-image|border-width/);
  });
  it('≤560 px windows give the ledger list more height without hiding anything', () => {
    const short = media('(max-height: 560px)');
    expect(short).toContain('.board-column > .mat-zone { height: clamp(70px, 24%, 104px); }');
    expect(short).not.toMatch(/class-summary[^}]*display: none/);
  });
  it('the hand shows the resource note on the card, above the card-back overlay, so the hand height never changes', () => {
    expect(css).toMatch(/\.app\.playmat \.hand \.card-resource-note \{ position: absolute;[^}]*bottom: calc\(100% \+ 10px\);[^}]*z-index: 4; \}/);
    expect(css).toContain('.app.playmat .hand .card-caption { position: relative; }');
  });
});
