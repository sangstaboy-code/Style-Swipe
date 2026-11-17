import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const config = JSON.parse(await readFile(resolve('keyless-sources.json'), 'utf8'));
const products = [];
const reports = [];
const agent = 'StyleSwipeCatalog/1.0 (+personal shopping research; respects robots.txt)';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function get(url, timeout = 11000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { Accept: 'application/json,text/plain,*/*', 'User-Agent': agent }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

function robotsAllows(robots, path) {
  // Evaluate relevant groups across the whole robots file, not only the last.
  const groups = robots.split(/\r?\n\s*\r?\n/);
  const rules = [];
  for (const group of groups) {
    const lines = group.split(/\r?\n/).map(s => s.split('#')[0].trim()).filter(Boolean);
    const agents = lines.filter(s => /^user-agent\s*:/i.test(s)).map(s => s.split(':').slice(1).join(':').trim());
    if (!agents.some(s => s === '*' || /StyleSwipeCatalog/i.test(s))) continue;
    for (const line of lines) {
      const m = line.match(/^(allow|disallow)\s*:\s*(.*?)\s*$/i);
      if (m && m[2].startsWith('/')) rules.push({ allow: m[1].toLowerCase() === 'allow', path: m[2].replace(/\*.*$/, '') });
    }
  }
  const applicable = rules.filter(r => path.startsWith(r.path)).sort((a,b)=>b.path.length-a.path.length);
  return !applicable.length || applicable[0].allow;
}

async function canRead(origin, path) {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:') return { ok: false, reason: 'HTTPS only' };
    const res = await get(new URL('/robots.txt', u));
    const txt = await res.text();
    return { ok: robotsAllows(txt, path), reason: 'robots.txt policy' };
  } catch (e) {
    // Unknown robots policy: skip conservatively rather than bypass it.
    return { ok: false, reason: `robots unavailable: ${e.message}` };
  }
}

// Shopify's public product JSON returns decimal currency prices (e.g. "49.00").
function asMoney(value) { return Number(value); }
function chooseVariant(p) {
  const variants = (p.variants || []).filter(v => v.available !== false && Number.isFinite(Number(v.price)) && Number(v.price) > 0);
  // Prefer variants potentially fitting Luke's sizes, then the lowest price.
  const sizeScore = v => {
    const label = [v.title, v.option1, v.option2, v.option3].filter(Boolean).join(' ').toLowerCase();
    return /\b(32x34|32\/34|32w 34l|medium|large|\bm\b|\bl\b|\b11\b)\b/.test(label) ? 0 : 1;
  };
  variants.sort((a, b) => sizeScore(a) - sizeScore(b) || Number(a.price) - Number(b.price));
  return variants[0] || null;
}

function addShopify(p, store, origin) {
  if (!p || !p.handle || !p.title) return false;
  // The user's discovery feed is menswear; exclude explicitly women's and
  // children's items without guessing a gender for unlabeled products.
  if (/\b(women'?s|ladies|girls|kids|children|toddler|baby)\b/i.test(p.title)) return false;
  const v = chooseVariant(p);
  if (!v) return false;
  const price = asMoney(v.price);
  const compare = asMoney(v.compare_at_price || 0);
  const image = p.image?.src || p.images?.[0]?.src;
  if (!image || price <= 0) return false;
  const base = `${origin.replace(/\/$/, '')}/products/${encodeURIComponent(p.handle)}`;
  products.push({
    title: p.title, brand: p.vendor || store, store,
    product_url: v.id ? `${base}?variant=${encodeURIComponent(v.id)}` : base,
    image_url: image, price, original_price: compare > price ? compare : price,
    currency: 'USD', availability: 'in_stock'
  });
  return true;
}

for (const store of config.stores || []) {
  const name = String(store.name || 'Store');
  const origin = String(store.origin || '').replace(/\/$/, '');
  const allowed = await canRead(origin, '/products.json');
  if (!allowed.ok) { reports.push({ name, count: 0, status: `Skipped: ${allowed.reason}` }); continue; }
  let count = 0;
  let status = 'ok';
  const pageSignatures = new Set();
  // Keep paginating until the storefront returns its last page, an error, or
  // GitHub Actions ends the job. There is no arbitrary product/page ceiling.
  for (let page = 1; ; page++) {
    try {
      const response = await get(`${origin}/products.json?limit=100&page=${page}`);
      if (new URL(response.url).origin !== new URL(origin).origin) throw new Error('redirected off-store');
      const json = await response.json();
      if (!Array.isArray(json.products)) throw new Error('No public Shopify product array');
      if (!json.products.length) break;
      // Some stores ignore the page parameter; stop if the same page repeats.
      const signature = json.products.map(p => p.id || p.handle).join('|');
      if (pageSignatures.has(signature)) break;
      pageSignatures.add(signature);
      for (const p of json.products) if (addShopify(p, name, origin)) count++;
      if (json.products.length < 100) break;
      await pause(700);
    } catch (e) { status = e.message; break; }
  }
  reports.push({ name, count, status });
  await pause(500);
}

// Optional explicit product-page seeds use JSON-LD Product metadata when
// available; no discovery crawl, authentication, proxies, or CAPTCHA bypass.
for (const link of (config.productPages || [])) {
  const url = new URL(link);
  const allowed = await canRead(url.origin, url.pathname);
  if (!allowed.ok) { reports.push({ name: url.hostname, count: 0, status: 'Skipped: robots policy' }); continue; }
  try {
    const html = await (await get(url)).text();
    const matches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    let count = 0;
    for (const match of matches) {
      let obj;
      try { obj = JSON.parse(match[1]); } catch { continue; }
      const entries = Array.isArray(obj) ? obj : obj['@graph'] || [obj];
      for (const d of entries) {
        if (!String(d['@type'] || '').includes('Product')) continue;
        const offer = Array.isArray(d.offers) ? d.offers[0] : d.offers;
        const image = Array.isArray(d.image) ? d.image[0] : d.image;
        if (!offer?.price || !image) continue;
        products.push({ title: d.name, brand: typeof d.brand === 'object' ? d.brand.name : d.brand,
          store: url.hostname, product_url: url.href, image_url: typeof image === 'object' ? image.url : image,
          price: Number(offer.price), original_price: Number(offer.price), currency: offer.priceCurrency || 'USD' });
        count++;
      }
    }
    reports.push({ name: url.href, count, status: 'ok' });
  } catch (e) { reports.push({ name: url.href, count: 0, status: e.message }); }
  await pause(700);
}

await writeFile(resolve('keyless-products.json'), JSON.stringify({ products }, null, 2) + '\n');
console.log(JSON.stringify({ total: products.length, reports }, null, 2));
