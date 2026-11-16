import { describe, expect, it } from 'vitest';
import { resolve, join } from 'node:path';
import { APP_URL, DEV_URL, PRODUCTION_CSP, isAllowedRequest, isTrustedPage, resolveBundleAsset } from '../electron/security';
import { cardSchema } from '../src/shared/contracts';
import { SAMPLE_CARDS } from '../src/shared/sample-cards';

describe('local security boundaries', () => {
  it('allows only the exact main document as IPC sender', () => {
    expect(isTrustedPage(APP_URL, false)).toBe(true);
    expect(isTrustedPage(`${DEV_URL}/`, true)).toBe(true);
    for (const url of [DEV_URL, 'app://bundle/other.html', 'https://example.com', `${APP_URL}?x=1`, 'app://bundle.evil/index.html']) {
      expect(isTrustedPage(url, false)).toBe(false);
    }
  });
  it('denies remote and file requests; dev only allows the fixed local server', () => {
    for (const url of ['https://example.com/a.js', 'http://127.0.0.1:9999', 'file:///C:/secret', 'app://evil/index.html', 'data:text/html,test']) {
      expect(isAllowedRequest(url, false)).toBe(false);
      expect(isAllowedRequest(url, true)).toBe(false);
    }
    expect(isAllowedRequest('app://bundle/assets/app.js', false)).toBe(true);
    expect(isAllowedRequest(`${DEV_URL}/src/main.tsx`, true)).toBe(true);
    expect(PRODUCTION_CSP).toContain("connect-src 'none'");
  });
  it('resolves only bundle assets and rejects traversal, unsupported files and malformed URLs', () => {
    const root = resolve('dist');
    expect(resolveBundleAsset(APP_URL, root)).toBe(join(root, 'index.html'));
    for (const url of ['app://bundle/%2e%2e%2fsecret.js', 'app://bundle/%5c..%5csecret.js', 'app://bundle/a%00.js', 'app://bundle/%zz.js', 'app://bundle/data.sqlite3', 'file:///C:/secret.js', 'app://bundle:90/main.js']) {
      expect(resolveBundleAsset(url, root)).toBeUndefined();
    }
  });
  it('sample cards honor domain shape without live resource state', () => {
    expect(SAMPLE_CARDS).toHaveLength(4);
    for (const card of SAMPLE_CARDS) expect(cardSchema.parse(card)).toEqual(card);
    expect(() => cardSchema.parse({ ...SAMPLE_CARDS[0], remaining: 5 })).toThrow();
    expect(() => cardSchema.parse({ ...SAMPLE_CARDS[0], castOptions: [{ id: 'x', label: 'x', costs: [], casting: { mode: 'standard', allowUpcast: true, allowBelowBase: true } }] })).toThrow();
  });
});
