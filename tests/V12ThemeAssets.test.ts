import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve('src/assets/playmat');
const css = readFileSync(resolve('src/theme-playmat.css'), 'utf8');
const THEMES = { oxblood: 'oxblood', ebony: 'ebony', verdant: 'felt', abyss: 'arcane' } as const;
/** The custom-property block of one theme (the default theme lives on `.app.playmat {`). */
const block = (theme: string) => {
  const start = theme === 'oxblood' ? css.indexOf('.app.playmat {') : css.indexOf(`.app.playmat[data-theme=${theme}] {`);
  return css.slice(start, css.indexOf('}', start));
};

describe('v1.2 theme assets (Phase 3–4)', () => {
  it('every theme has its own material, frame, page corners, recovery token and bookmark, wired in its CSS block', () => {
    const material = { oxblood: 'leather-grain.png', ebony: 'wood-grain.png', verdant: 'felt-grain.png', abyss: 'stone-grain.png' } as const;
    const seen = new Set<string>();
    for (const [theme, name] of Object.entries(THEMES)) {
      const vars = block(theme);
      const files = [material[theme as keyof typeof material], `frame-${name}.png`, `panel-${name}.png`, `rest-${name}.svg`, `bookmark-${name}.svg`];
      for (const file of files) {
        expect(existsSync(resolve(dir, file)), file).toBe(true);
        expect(vars, `${theme} uses ${file}`).toContain(`./assets/playmat/${file}`);
        seen.add(file);
      }
    }
    expect(seen.size).toBe(20);
  });

  it('the vector tokens and bookmarks are self-contained (no external links, embedded images or scripts) and carry their asset id', () => {
    for (const name of Object.values(THEMES)) for (const kind of ['rest', 'bookmark']) {
      const svg = readFileSync(resolve(dir, `${kind}-${name}.svg`), 'utf8');
      expect(svg.startsWith(`<svg id="${kind}-${name}" xmlns="http://www.w3.org/2000/svg" viewBox=`)).toBe(true);
      expect(svg).not.toMatch(/<image|<script|href=|https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
    }
  });

  it('아케인 블루 has no metal: it never points at the metal frames, coins as recovery tokens or metal page corners', () => {
    const vars = block('abyss');
    expect(vars).not.toMatch(/frame-(gold|silver|oxblood|ebony|felt)|panel-(oxblood|ebony|felt)|rest-(oxblood|ebony|felt)|bookmark-(oxblood|ebony|felt)/);
    expect(css).toContain(".app.playmat[data-theme=abyss] :is(.ledger-page, .codex-page)");
  });
});
