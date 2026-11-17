/* Taste model for Style Swipe. Pure functions, no DOM, so it can be tested in Node. */
(function (root) {
  'use strict';

  // Starting taste from Luke's outfit references (updated Nov 17, 2026).
  // These are soft preferences, not filters: swipes can change the ranking.
  var PRIORS = {
    'theme:workwear': 1.2,
    'theme:independent-brand': 0.7,
    'theme:vintage': 1.15,
    'theme:graphic-tee': 0.9,
    'theme:western-graphic': 0.9,
    'theme:distressed-print': 0.7,
    'theme:baggy-denim': 1.1,
    'theme:wide-leg': 1.0,
    'theme:boxy-fit': 0.9,
    'theme:preppy': 0.75,
    'theme:loafers': 0.75,
    'theme:waffle-knit': 0.6,
    'theme:chunky-knit': 0.9,
    'theme:knit-polo': 0.8,
    'theme:henley': 0.65,
    'theme:pleated-trousers': 0.8,
    'theme:leather-bomber': 0.8,
    'theme:canvas-jacket': 0.85,
    'theme:camo': 0.65,
    'theme:flannel': 0.6,
    'theme:suede': 0.55,
    'theme:sporty': 0.5,
    'theme:retro-sport': 0.6,
    'theme:oversized-sweatshirt': 0.7,
    'color:brown': 0.9,
    'color:olive': 0.65,
    'color:navy': 0.8,
    'color:burgundy': 0.75,
    'color:cream': 0.65,
    'color:tan': 0.55,
    'color:light-blue': 0.55,
    'color:charcoal': 0.65,
    'color:washed-black': 0.65,
    'color:forest-green': 0.6
  };

  var SAVE_STEP = 0.5;
  var PASS_STEP = -0.3;
  var CLAMP = 3;

  function priceBand(price) {
    if (price < 40) return 'under $40';
    if (price < 80) return '$40 to $80';
    return '$80 to $110';
  }

  function discountPct(deal) {
    if (!deal || !(deal.was > 0) || !(deal.price >= 0)) return 0;
    return Math.max(0, Math.round((1 - deal.price / deal.was) * 100));
  }
  function isDeal(deal) { return !!deal && deal.was > deal.price && discountPct(deal) >= 10; }
  function isMajorBrand(deal) {
    var name = [deal && deal.brand, deal && deal.store].filter(Boolean).join(' ').toLowerCase();
    return /\b(nike|carhartt|skims|adidas|calvin klein|levi'?s|the north face|patagonia|ralph lauren|polo|new balance|converse|vans|under armour|puma|reebok|gap|abercrombie|hollister|american eagle|champion|columbia|lululemon|urban outfitters|h&m|zara|uniqlo|asos|gymshark|alo yoga|vuori|birkenstock|dr martens|timberland|coach|tommy hilfiger|dickies|crocs|brooks|asics|on running|allbirds)\b/i.test(name);
  }
  function isBigBrandSteal(deal, minimum) {
    return isMajorBrand(deal) && discountPct(deal) >= (minimum == null ? 30 : minimum);
  }

  // Every property of a deal that the model learns from, as "kind:value" keys.
  function featuresOf(deal) {
    var f = [];
    if (deal.category) f.push('cat:' + deal.category);
    (deal.tags || []).forEach(function (t) { f.push('theme:' + t); });
    (deal.colors || []).forEach(function (c) { f.push('color:' + c); });
    if (deal.brand) f.push('brand:' + deal.brand);
    if (deal.store) f.push('store:' + deal.store);
    if (typeof deal.price === 'number') f.push('price:' + priceBand(deal.price));
    if (deal.wildcard) f.push('wild:yes');
    return f;
  }

  function score(deal, weights) {
    var f = featuresOf(deal);
    if (!f.length) return 0;
    var sum = 0;
    for (var i = 0; i < f.length; i++) sum += weights[f[i]] || 0;
    var base = sum / Math.sqrt(f.length);
    var pct = discountPct(deal);
    var major = isMajorBrand(deal);
    // Big-brand clearance is a top priority without turning the whole feed into ads.
    var bonus = Math.min(pct, 80) / 80 * (major ? 1.7 : 0.9) + (major && pct >= 30 ? 0.55 : 0);
    // Deals with a known size problem (for example, the wrong inseam) sink in the deck.
    var penalty = (deal.fitIssue ? 0.5 : 0) + (deal.price > 110 ? Math.min(0.7, (deal.price - 110) / 300) : 0);
    return base + bonus - penalty;
  }

  // Applies a swipe to the weights and returns the deltas so it can be undone.
  function learn(weights, deal, action) {
    var step = action === 'save' ? SAVE_STEP : PASS_STEP;
    var deltas = {};
    featuresOf(deal).forEach(function (k) {
      var before = weights[k] || 0;
      var after = Math.max(-CLAMP, Math.min(CLAMP, before + step));
      weights[k] = after;
      deltas[k] = after - before;
    });
    return deltas;
  }

  function unlearn(weights, deltas) {
    Object.keys(deltas).forEach(function (k) {
      weights[k] = (weights[k] || 0) - deltas[k];
    });
  }

  // Order the unseen deals: best score first, but with probability epsilon pick a random one
  // so the deck keeps surprising you and the model keeps learning what you like.
  function buildQueue(deals, seen, weights, rand, epsilon) {
    rand = rand || Math.random;
    epsilon = epsilon == null ? 0.2 : epsilon;
    var pool = deals.filter(function (d) { return !seen[d.id]; });
    var scored = pool.map(function (d) { return { d: d, s: score(d, weights) + rand() * 0.01 }; });
    scored.sort(function (a, b) { return b.s - a.s; });
    var rest = scored.map(function (x) { return x.d; });
    var out = [];
    while (rest.length) {
      var idx = 0;
      if (out.length > 0 && rand() < epsilon) idx = Math.floor(rand() * rest.length);
      out.push(rest.splice(idx, 1)[0]);
    }
    return out;
  }

  // Aim for 60% tailored, 25% deals, 15% exploration over 20 cards.
  // If a lane is empty, use remaining verified inventory rather than repeat.
  function buildDiscoveryQueue(deals, seen, weights, rand, mode) {
    rand = rand || Math.random;
    var unseen = deals.filter(function (d) { return !seen[d.id]; });
    if (mode === 'steals') return unseen.filter(function (d) { return isBigBrandSteal(d); })
      .sort(function (a, b) { return discountPct(b) - discountPct(a) || score(b, weights) - score(a, weights); });
    if (mode === 'deals') return buildQueue(unseen.filter(isDeal), {}, weights, rand, 0.15);
    if (mode === 'explore') return shuffle(unseen, rand);
    var ranked = unseen.slice().sort(function (a, b) { return score(b, weights) - score(a, weights); });
    var dealsRanked = ranked.filter(isDeal);
    var wild = shuffle(unseen, rand);
    var out = [], used = {}, positions = { 'for-you': 0, deals: 0, explore: 0 };
    var slots = ['for-you','for-you','deals','for-you','explore','for-you','deals','for-you','explore','for-you',
      'for-you','deals','for-you','explore','for-you','deals','for-you','for-you','deals','for-you'];
    while (out.length < unseen.length) {
      var kind = slots[out.length % 20];
      var pool = kind === 'deals' ? dealsRanked : kind === 'explore' ? wild : ranked;
      var pos = positions[kind];
      while (pos < pool.length && used[pool[pos].id]) pos++;
      positions[kind] = pos + 1;
      var choice = pool[pos];
      if (!choice) {
        while (positions['for-you'] < ranked.length && used[ranked[positions['for-you']].id]) positions['for-you']++;
        choice = ranked[positions['for-you']++];
      }
      if (!choice) break;
      used[choice.id] = true;
      out.push(Object.assign({}, choice, { lane: kind === 'deals' && isDeal(choice) ? 'deals' : kind === 'explore' ? 'explore' : 'for-you' }));
    }
    return out;
  }
  function shuffle(items, rand) {
    var a = items.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  var LABELS = { cat: 'Type', theme: 'Style', color: 'Color', brand: 'Brand', store: 'Store', price: 'Price', wild: 'Wildcards' };

  function prettyKey(key) {
    var i = key.indexOf(':');
    var kind = key.slice(0, i);
    var val = key.slice(i + 1);
    if (key === 'wild:yes') return 'Wildcard picks';
    val = val.replace(/-/g, ' ');
    val = val.charAt(0).toUpperCase() + val.slice(1);
    return (LABELS[kind] || kind) + ': ' + val;
  }

  // Strongest likes and dislikes, ignoring noise from a single swipe.
  function summarize(weights, minAbs) {
    minAbs = minAbs == null ? 0.25 : minAbs;
    var rows = Object.keys(weights).map(function (k) { return { key: k, w: weights[k], label: prettyKey(k) }; })
      .filter(function (r) { return Math.abs(r.w) >= minAbs; });
    var likes = rows.filter(function (r) { return r.w > 0; }).sort(function (a, b) { return b.w - a.w; });
    var dislikes = rows.filter(function (r) { return r.w < 0; }).sort(function (a, b) { return a.w - b.w; });
    return { likes: likes, dislikes: dislikes };
  }

  function safeUrl(u) {
    try {
      var x = new URL(u);
      return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : '';
    } catch (e) { return ''; }
  }

  var api = {
    PRIORS: PRIORS, priceBand: priceBand, discountPct: discountPct, isDeal: isDeal, isMajorBrand: isMajorBrand, isBigBrandSteal: isBigBrandSteal, featuresOf: featuresOf,
    score: score, learn: learn, unlearn: unlearn, buildQueue: buildQueue, buildDiscoveryQueue: buildDiscoveryQueue, summarize: summarize,
    prettyKey: prettyKey, safeUrl: safeUrl
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Taste = api;
})(typeof window !== 'undefined' ? window : this);
