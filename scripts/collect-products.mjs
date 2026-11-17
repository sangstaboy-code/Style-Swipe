// Multi-source deal collection. All credentials stay in this Node process,
// never in the static web app. Run on a trusted machine or GitHub Actions.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const queries = [
  'mens chore jacket', 'mens carpenter pants', 'mens graphic tee vintage',
  'mens wide leg jeans', 'mens knit polo', 'mens cardigan',
  'mens leather bomber jacket', 'mens corduroy pants', 'mens loafers',
  'mens suede sneakers', 'mens wool sweater', 'mens workwear jacket',
  'mens pleated trousers', 'mens flannel shirt', 'mens rugby shirt',
  'mens quarter zip', 'mens trail sneakers', 'mens denim jacket',
  'mens casual shirt', 'mens cargo pants', 'mens varsity jacket',
  'mens patterned sweater', 'mens relaxed chinos', 'mens hoodie',
  'mens vintage horse graphic t shirt', 'mens distressed star print sweatshirt',
  'mens heavyweight boxy crewneck', 'mens western vintage graphic tee',
  'mens washed black boxy t shirt', 'mens faded canvas zip jacket',
  'mens brown detroit jacket', 'mens camouflage carpenter pants',
  'mens relaxed camo cargo pants', 'mens oversized rib knit sweater',
  'mens burgundy chunky knit sweater', 'mens forest green cable knit sweater',
  'mens waffle knit polo sweater', 'mens cream henley sweatshirt',
  'mens wide pleated charcoal trousers', 'mens relaxed wool trousers',
  'mens stonewashed baggy jeans', 'mens light wash loose jeans',
  'mens brown leather moc toe shoes', 'mens suede burgundy sneakers',
  'mens vintage baseball cap', 'mens plaid scarf',
  'mens vintage leather zip bomber', 'mens nylon track pants retro',
  'mens navy windbreaker jacket', 'mens boxy cardigan',
  'mens green plaid overshirt', 'mens rugby stripe shirt',
  'mens tech runner sneakers', 'mens classic black overcoat'
];
const max = process.env.MAX_PRICE ? Number(process.env.MAX_PRICE) : Infinity;
const products = [];
const reports = [];
function report(source, count, warning = '') { reports.push({ source, count, warning }); }
function field(o, ...keys) { for (const k of keys) if (o[k] != null && o[k] !== '') return o[k]; return undefined; }
function numeric(x) {
  if (typeof x === 'number') return x;
  if (typeof x !== 'string') return NaN;
  const m = x.replace(/,/g, '').match(/(?:USD\s*)?\$?\s*(\d+(?:\.\d{1,2})?)/i);
  return m ? Number(m[1]) : NaN;
}
function titleFeatures(s) {
  s = s.toLowerCase();
  const patterns = ['workwear', 'vintage', 'preppy', 'graphic-tee', 'baggy-denim', 'waffle-knit', 'sporty', 'minimal', 'streetwear'];
  const tags = patterns.filter(x => s.includes(x.replace('-', ' ')));
  for (const word of ['chore', 'carpenter', 'corduroy', 'leather', 'suede', 'knit', 'denim', 'flannel']) {
    if (s.includes(word)) tags.push(word === 'chore' || word === 'carpenter' ? 'workwear' : word);
  }
  const rules = [
    [/horse|western|cowboy|rodeo/, 'western-graphic'],
    [/distress|faded print|cracked print/, 'distressed-print'],
    [/wide.leg|loose.fit|baggy|relaxed.fit/, 'wide-leg'],
    [/baggy.*jean|loose.*jean|wide.*denim/, 'baggy-denim'],
    [/boxy|cropped jacket/, 'boxy-fit'],
    [/chunky.*knit|cable.*knit|fisherman.*sweater|rib.*sweater/, 'chunky-knit'],
    [/knit.*polo|polo.*sweater/, 'knit-polo'],
    [/henley/, 'henley'],
    [/pleated.*trouser|pleated.*pant/, 'pleated-trousers'],
    [/leather.*bomber|bomber.*leather/, 'leather-bomber'],
    [/canvas.*jacket|detroit.*jacket|chore.*jacket/, 'canvas-jacket'],
    [/camo|camouflage/, 'camo'],
    [/track.*pant|track.*jacket|retro.*sport|windbreaker/, 'retro-sport'],
    [/oversized.*sweatshirt|boxy.*crewneck/, 'oversized-sweatshirt'],
    [/loafer|moc.toe/, 'loafers'],
    [/suede/, 'suede']
  ];
  for (const [re, tag] of rules) if (re.test(s)) tags.push(tag);
  const colors = ['brown', 'olive', 'navy', 'burgundy', 'cream', 'tan', 'black', 'grey', 'white', 'green', 'blue'].filter(c => s.includes(c));
  if (/charcoal/.test(s)) colors.push('charcoal');
  if (/washed.black|faded.black/.test(s)) colors.push('washed-black');
  if (/forest.green/.test(s)) colors.push('forest-green');
  if (/light.wash|light.blue/.test(s)) colors.push('light-blue');
  const category = /cap|hat|scarf|bag|watch|sunglass/.test(s) ? 'accessories'
    : /jacket|coat|bomber|parka|windbreaker/.test(s) ? 'outerwear'
    : /jeans|pants|trousers|chinos/.test(s) ? 'bottoms'
    : /shoe|sneaker|loafer|boot/.test(s) ? 'shoes' : 'tops';
  return { tags: [...new Set(tags)], colors, category };
}
function normalize(o, source) {
  const name = String(field(o, 'title', 'name', 'product_name', 'productName') || '').trim();
  const url = field(o, 'link', 'url', 'product_url', 'productUrl', 'buy_url', 'clickUrl');
  const image = field(o, 'image_link', 'image', 'image_url', 'imageUrl', 'largeImage', 'product_image');
  const brand = String(field(o, 'brand', 'manufacturer') || source).trim();
  const sale = field(o, 'sale_price', 'salePrice');
  const price = numeric(sale ?? field(o, 'current_price', 'price'));
  const oldPrice = numeric(field(o, 'original_price', 'originalPrice', 'regular_price', 'list_price', 'was', 'price_before_discount') ?? (sale != null ? o.price : undefined));
  const was = Number.isFinite(oldPrice) && oldPrice >= price ? oldPrice : price;
  const currency = String(field(o, 'currency', 'price_currency') || 'USD').toUpperCase();
  const availability = String(field(o, 'availability', 'stock_status') || '').toLowerCase();
  if (!name || !url || !image || currency !== 'USD' || !Number.isFinite(price) ||
      price <= 0 || price > max || /out.of.stock|sold.out|unavailable/.test(availability)) return null;
  const { category, tags, colors } = titleFeatures(name);
  const independentBrands = ['3sixteen', 'Freenote Cloth', 'Dehen 1920', 'Rogue Territory', 'Corridor', 'Alex Mill', 'Knickerbocker', 'Manresa', 'Imogene + Willie', 'Howler Brothers', 'Katin', 'Taylor Stitch', 'Standard & Strange', 'Blue Owl Workshop', 'Canoe Club', 'Snake Oil Provisions'];
  if (independentBrands.some(b => b.toLowerCase() === String(field(o, 'store', 'merchant', 'retailer') || '').toLowerCase())) tags.push('independent-brand');
  return {
    id: `${source.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${createHash('sha256').update(String(url)).digest('hex').slice(0, 24)}`,
    name, brand, store: String(field(o, 'store', 'merchant', 'retailer') || source),
    category, price, was, url: String(url), image: String(image),
    tags, colors, wildcard: false, checked: 'listing', added: new Date().toISOString().slice(0, 10)
  };
}

// Sources: any number of local JSON/JSONL/CSV or TSV product-feed exports.
// Google Merchant-style headers and common affiliate export columns supported.
function parseDelimited(s, delimiter) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') { if (quoted && s[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === delimiter && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); if (row.some(x => x)) rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  row.push(cell); if (row.some(x => x)) rows.push(row);
  const headers = (rows.shift() || []).map(x => x.trim().toLowerCase().replace(/\s+/g, '_'));
  return rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] || ''])));
}
function parseProducts(raw, path) {
  return /\.jsonl$/i.test(path) ? raw.split(/\r?\n/).filter(Boolean).map(JSON.parse)
    : /\.(csv|tsv|txt)$/i.test(path) ? parseDelimited(raw, /\.(tsv|txt)$/i.test(path) ? '\t' : ',')
    : JSON.parse(raw);
}
function addRows(rows, source) {
  const items = Array.isArray(rows) ? rows : rows.deals || rows.products || rows.items || [];
  const before = products.length;
  for (const item of items) { const d = normalize(item, source); if (d) products.push(d); }
  report(source, products.length - before);
}
for (const path of process.argv.slice(2)) {
  const source = path.split('/').pop().replace(/\.(jsonl?|csv|tsv|txt)$/i, '');
  try {
    const raw = await readFile(resolve(path), 'utf8');
    addRows(parseProducts(raw, path), source);
  } catch (e) { report(source, 0, e.message); }
}

// Authenticated feed endpoints configured privately as a JSON array of
// {"name":"Retailer", "url":"https://approved-feed-url", "format":"csv"}.
// Never commit endpoint URLs containing tokens to the public repository.
if (process.env.PRODUCT_FEEDS_JSON) {
  try {
    for (const entry of JSON.parse(process.env.PRODUCT_FEEDS_JSON)) {
      const name = String(entry.name || 'Approved feed');
      try {
        const url = new URL(entry.url);
        if (url.protocol !== 'https:') throw new Error('HTTPS required');
        const result = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!result.ok) throw new Error(`HTTP ${result.status}`);
        const contents = await result.text();
        addRows(parseProducts(contents, `feed.${entry.format || 'csv'}`), name);
      } catch (e) { report(name, 0, e.message); }
    }
  } catch (e) { report('Approved product feeds', 0, 'Invalid PRODUCT_FEEDS_JSON configuration'); }
}

// eBay API supplies photos and prices. If marketingPrice is absent, the item
// is a regular-price listing, never labeled a discount.
if (process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET) {
  try {
    const auth = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64');
    const tokenResult = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
    });
    if (!tokenResult.ok) throw new Error(`eBay token HTTP ${tokenResult.status}`);
    const { access_token } = await tokenResult.json();
    const before = products.length;
    for (const q of queries) {
      const p = new URLSearchParams({ q, limit: '100', filter: `price:[1..${max}],priceCurrency:USD`, sort: 'newlyListed' });
      const res = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${p}`, {
        headers: { Authorization: `Bearer ${access_token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' }
      });
      if (!res.ok) { report(`eBay ${q}`, 0, `HTTP ${res.status}`); continue; }
      const json = await res.json();
      for (const item of json.itemSummaries || []) {
        const d = normalize({ title: item.title, brand: 'eBay listing', store: 'eBay',
          link: item.itemWebUrl, image_link: item.image?.imageUrl, price: item.price?.value,
          original_price: item.marketingPrice?.originalPrice?.value, currency: item.price?.currency }, 'eBay');
        if (d) products.push(d);
      }
    }
    report('eBay API', products.length - before);
  } catch (e) { report('eBay API', 0, e.message); }
} else report('eBay API', 0, 'Add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET to enable');

const output = resolve('incoming-products.json');
await writeFile(output, JSON.stringify({ products, reports }, null, 2) + '\n');
console.log(JSON.stringify({ output, totalCandidates: products.length, reports }, null, 2));
