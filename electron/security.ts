import { resolve, sep, extname } from 'node:path';

export const APP_URL = 'app://bundle/index.html';
export const DEV_URL = 'http://127.0.0.1:5173';
export const PRODUCTION_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function isTrustedPage(url: string, development: boolean): boolean {
  return url === (development ? `${DEV_URL}/` : APP_URL);
}
export function isAllowedRequest(url: string, development: boolean): boolean {
  try {
    const parsed = new URL(url);
    if (development) return (parsed.origin === DEV_URL || (parsed.protocol === 'ws:' && parsed.host === '127.0.0.1:5173'));
    return parsed.protocol === 'app:' && parsed.host === 'bundle' && !parsed.username && !parsed.password && !parsed.port;
  } catch { return false; }
}
export function resolveBundleAsset(url: string, root: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (!isAllowedRequest(url, false)) return;
    const path = decodeURIComponent(parsed.pathname);
    if (path.includes('\\') || path.includes('\0') || path.split('/').includes('..')) return;
    const target = resolve(root, `.${path}`);
    if (!target.startsWith(`${resolve(root)}${sep}`)) return;
    if (!['.html', '.js', '.css', '.png', '.webp', '.jpg', '.svg'].includes(extname(target))) return;
    return target;
  } catch { return; }
}
