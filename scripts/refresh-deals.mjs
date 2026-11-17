import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/refresh-deals.mjs incoming-products.json');
  process.exit(2);
}

const raw = JSON.parse(await readFile(resolve(input), 'utf8'));
const entries = Array.isArray(raw) ? raw : raw.deals || raw.products;
if (!Array.isArray(entries)) throw new Error('Expected an array or {"deals": [...]}');
const offlineImages = process.argv.includes('--offline-images');

function validUrl(value) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol); }
  catch { return false; }
}

async function validImage(url) {
  try {
    // HEAD avoids downloading hundreds of full-resolution product images.
    // Some image CDNs reject HEAD, so retry a GET in that case.
    let res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(6500), headers: { Accept: 'image/*' } });
    if (res.status === 405 || res.status === 403 || !res.headers.get('content-type')) {
      res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(6500), headers: { Accept: 'image/*' } });
      if (res.body) await res.body.cancel();
    }
    if (!res.ok || !(res.headers.get('content-type') || '').toLowerCase().startsWith('image/')) return false;
    // A tiny empty tracking pixel isn't a useful product photo.
    const len = Number(res.headers.get('content-length') || 0);
    return !len || len >= 1000;
  } catch { return false; }
}

const candidates = [];
const seen = new Set();
let invalid = 0;
for (const d of entries) {
  if (!d || !d.id || !d.name || !d.brand || !d.store ||
      !Number.isFinite(d.price) || d.price <= 0 ||
      (Number.isFinite(d.was) && d.was < d.price) || !validUrl(d.url) || !validUrl(d.image) ||
      seen.has(new URL(d.url).origin + new URL(d.url).pathname)) { invalid++; continue; }
  seen.add(new URL(d.url).origin + new URL(d.url).pathname);
  candidates.push(d);
}

// Validate image URLs concurrently without flooding retail CDNs.
const outcomes = new Array(candidates.length);
if (offlineImages) outcomes.fill(true);
else {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(12, candidates.length) }, async () => {
    while (cursor < candidates.length) {
      const i = cursor++;
      outcomes[i] = await validImage(candidates[i].image);
    }
  }));
}
const kept = candidates.filter((d, i) => outcomes[i]);
invalid += candidates.length - kept.length;

if (!kept.length) throw new Error(`No usable deals from ${entries.length} products; existing feed preserved`);
const output = join(root, 'deals.json');
const temporary = join(root, 'deals.json.tmp');
await writeFile(temporary, JSON.stringify({ updated: new Date().toISOString().slice(0, 10), imageValidation: offlineImages ? 'url-only' : 'network-checked', deals: kept }, null, 2) + '\n');
await rename(temporary, output);
console.log(`Published ${kept.length} ${offlineImages ? 'image-URL-present (not network verified)' : 'photo-verified'} products; excluded ${invalid}`);
