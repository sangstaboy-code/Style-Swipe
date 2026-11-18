(function () {
  'use strict';
  var T = window.Taste;
  var STORE_KEY = 'styleSwipe.v1';

  var state = { seen: {}, weights: {}, history: [], saved: {} };
  var data = { deals: [], updated: '' };
  var queue = [];
  var busy = false;
  var feedMode = 'for-you';
  var categoryFilter = 'all';
  var priceFilter = 'all';
  var brandFilter = 'all';
  var labelFilter = 'all';
  var genderFilter = 'men';

  function $(id) { return document.getElementById(id); }

  // ---------- storage (may be unavailable, so always guarded) ----------
  function load() {
    var stored = null;
    try { stored = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { stored = null; }
    state.seen = (stored && stored.seen) || {};
    state.history = (stored && stored.history) || [];
    state.saved = (stored && stored.saved) || {};
    state.weights = Object.assign({}, T.PRIORS, (stored && stored.weights) || {});
    try { genderFilter = localStorage.getItem('styleSwipe.department') || 'men'; } catch (e) { genderFilter = 'men'; }
    if (!['men', 'women', 'all'].includes(genderFilter)) genderFilter = 'men';
  }
  function persist() {
    try {
      state.history = state.history.slice(-30);
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) { /* storage unavailable: the app still works for this visit */ }
  }

  // ---------- helpers ----------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function money(n) {
    return '$' + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '');
  }
  function fmtDate(iso) {
    var d = new Date(iso + 'T12:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function daysOld(iso) {
    var d = new Date(iso + 'T12:00:00');
    if (isNaN(d)) return 0;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }
  function dealById(id) {
    for (var i = 0; i < data.deals.length; i++) if (data.deals[i].id === id) return data.deals[i];
    return state.saved[id] ? state.saved[id].deal : null;
  }

  function visual(deal, cls) {
    var box = el('div', cls);
    box.style.setProperty('--swatch', /^#[0-9a-f]{3,8}$/i.test(deal.color || '') ? deal.color : '#4a4034');
    var ph = el('div', 'ph', deal.category || 'style');
    box.appendChild(ph);
    var src = T.safeUrl(deal.image || '');
    if (src) {
      var img = document.createElement('img');
      img.alt = deal.brand + ' ' + deal.name;
      img.referrerPolicy = 'no-referrer';
      img.decoding = 'async';
      img.draggable = false;
      img.addEventListener('load', function () { box.classList.add('has-img'); });
      img.addEventListener('error', function () {
        // Never leave a blank photo card in the swipe deck.
        img.remove();
        if (cls === 'media') {
          state.hiddenImages = state.hiddenImages || {};
          state.hiddenImages[deal.id] = true;
          queue = queue.filter(function (item) { return item.id !== deal.id; });
          renderDeck();
        }
      });
      img.src = src;
      box.appendChild(img);
    }
    return box;
  }

  // ---------- card ----------
  function buildCard(deal, isTop) {
    var card = el('article', 'card' + (isTop ? ' top' : ' peek'));
    card.dataset.id = deal.id;
    var pct = T.discountPct(deal);

    var media = visual(deal, 'media');
    var badge = el('span', 'badge' + (T.isDeal(deal) ? '' : ' standard'), T.isDeal(deal) ? '-' + pct + '%' : 'STYLE PICK');
    media.appendChild(badge);
    if (deal.added && deal.added === data.updated) media.appendChild(el('span', 'new', 'New'));
    if (deal.lane === 'explore' || deal.wildcard) media.appendChild(el('span', 'wild', 'Something different'));
    var stampSave = el('div', 'stamp stamp-save', 'SAVE');
    var stampPass = el('div', 'stamp stamp-pass', 'PASS');
    media.appendChild(stampSave);
    media.appendChild(stampPass);
    card.appendChild(media);

    var info = el('div', 'info');
    info.appendChild(el('p', 'brand-line', deal.brand === deal.store ? deal.brand : deal.brand + ' · ' + deal.store));
    info.appendChild(el('h2', 'name', deal.name));
    var prices = el('div', 'prices');
    prices.appendChild(el('span', 'now', money(deal.price)));
    if (T.isDeal(deal)) {
      prices.appendChild(el('span', 'was', money(deal.was)));
      prices.appendChild(el('span', 'save-amt', 'save ' + money(deal.was - deal.price)));
    }
    info.appendChild(prices);
    if (deal.note) info.appendChild(el('p', 'note' + (deal.fitIssue ? ' warn' : ''), (deal.fitIssue ? 'Check fit: ' : '') + deal.note));
    var proof = deal.checked === 'page'
      ? 'Price seen on the product page, ' + fmtDate(data.updated)
      : 'Catalog price as of ' + fmtDate(data.updated) + '. Confirm at checkout.';
    info.appendChild(el('p', 'proof ' + (deal.checked === 'page' ? 'ok' : 'soft'), proof));
    var url = T.safeUrl(deal.url);
    if (url) {
      var a = el('a', 'open', 'View at ' + deal.store);
      a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      info.appendChild(a);
    }
    card.appendChild(info);
    if (isTop) attachDrag(card, stampSave, stampPass);
    return card;
  }

  // ---------- deck ----------
  function rebuildQueue(lockTop) {
    var top = lockTop && queue.length ? queue[0] : null;
    var seenNow = Object.assign({}, state.seen);
    if (top) seenNow[top.id] = 'locked';
    var filtered = data.deals.filter(function (d) {
      return !(state.hiddenImages || {})[d.id] &&
        (genderFilter === 'all' || d.gender === genderFilter || d.gender === 'unisex' || !d.gender) &&
        (categoryFilter === 'all' || d.category === categoryFilter) &&
        (priceFilter === 'all' || d.price <= Number(priceFilter)) &&
        (brandFilter === 'all' || d.brand === brandFilter) &&
        (labelFilter === 'all' || (d.tags || []).indexOf('independent-brand') >= 0);
    });
    var rest = T.buildDiscoveryQueue(filtered, seenNow, state.weights, Math.random, feedMode);
    queue = top ? [top].concat(rest) : rest;
  }

  function renderDeck() {
    var stack = $('stack');
    stack.textContent = '';
    var has = queue.length > 0;
    $('empty').hidden = has || !!$('load-error').dataset.on;
    $('empty-description').textContent = 'No more clothing matches in this feed. Try another category or Explore. New items appear when the catalog is refreshed.';
    $('controls').hidden = !has;
    $('hint').hidden = !has || Object.keys(state.seen).length > 2;
    if (!has) return;
    if (queue[1]) stack.appendChild(buildCard(queue[1], false));
    stack.appendChild(buildCard(queue[0], true));
    var left = queue.length;
    var totalBrands = new Set(data.deals.map(function (d) { return d.brand; })).size;
    $('updated').textContent = left + ' to swipe · ' + data.deals.length + ' items from ' + totalBrands +
      (totalBrands === 1 ? ' brand' : ' brands') + ' · updated ' + fmtDate(data.updated) +
      (daysOld(data.updated) > 3 ? ' (older than usual)' : '');
  }

  function commit(action) {
    var deal = queue[0];
    if (!deal) return;
    var deltas = T.learn(state.weights, deal, action);
    state.seen[deal.id] = action;
    state.history.push({ id: deal.id, action: action, deltas: deltas });
    if (action === 'save') state.saved[deal.id] = { deal: deal, savedAt: Date.now() };
    queue.shift();
    persist();
    rebuildQueue(true);
    renderDeck();
    renderSavedCount();
  }

  function undo() {
    if (busy) return;
    var last = state.history.pop();
    if (!last) return;
    T.unlearn(state.weights, last.deltas);
    delete state.seen[last.id];
    if (last.action === 'save') delete state.saved[last.id];
    var deal = dealById(last.id) || data.deals.filter(function (d) { return d.id === last.id; })[0];
    persist();
    rebuildQueue(false);
    if (deal) queue = [deal].concat(queue.filter(function (d) { return d.id !== deal.id; }));
    renderDeck();
    renderSavedCount();
  }

  function fling(action) {
    if (busy || !queue.length) return;
    var card = document.querySelector('.card.top');
    if (!card) return;
    busy = true;
    var dir = action === 'save' ? 1 : -1;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { busy = false; commit(action); return; }
    card.style.transition = 'transform 260ms ease-out, opacity 260ms ease-out';
    card.style.transform = 'translate(' + dir * (window.innerWidth) + 'px, -40px) rotate(' + dir * 18 + 'deg)';
    card.style.opacity = '0';
    setTimeout(function () { busy = false; commit(action); }, 250);
  }

  // ---------- drag ----------
  function attachDrag(card, stampSave, stampPass) {
    var startX = 0, startY = 0, dx = 0, dragging = false, moved = false, startT = 0, pid = null;
    var THRESH = 110;

    card.addEventListener('pointerdown', function (e) {
      if (busy || e.button > 0) return;
      dragging = true; moved = false; pid = e.pointerId;
      startX = e.clientX; startY = e.clientY; dx = 0; startT = Date.now();
      card.style.transition = 'none';
    });
    card.addEventListener('pointermove', function (e) {
      if (!dragging || e.pointerId !== pid) return;
      dx = e.clientX - startX;
      var dy = e.clientY - startY;
      if (!moved && Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (!moved) { moved = true; try { card.setPointerCapture(pid); } catch (err) {} }
      card.style.transform = 'translate(' + dx + 'px, ' + dy * 0.3 + 'px) rotate(' + dx / 18 + 'deg)';
      var p = Math.min(1, Math.abs(dx) / THRESH);
      stampSave.style.opacity = dx > 0 ? p : 0;
      stampPass.style.opacity = dx < 0 ? p : 0;
    });
    function end(e) {
      if (!dragging || (e && e.pointerId !== pid)) return;
      dragging = false;
      try { card.releasePointerCapture(pid); } catch (err) {}
      var v = Math.abs(dx) / Math.max(1, Date.now() - startT);
      if (moved && (Math.abs(dx) > THRESH || v > 0.6 && Math.abs(dx) > 40)) {
        fling(dx > 0 ? 'save' : 'pass');
      } else {
        card.style.transition = 'transform 220ms cubic-bezier(.2,.9,.3,1.2)';
        card.style.transform = '';
        stampSave.style.opacity = 0; stampPass.style.opacity = 0;
      }
    }
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', end);
    // A drag that ends on the link should not open it.
    card.addEventListener('click', function (e) {
      if (moved && e.target.closest && e.target.closest('a')) { e.preventDefault(); }
      moved = false;
    }, true);
  }

  // ---------- saved ----------
  function renderSavedCount() {
    $('saved-count').textContent = Object.keys(state.saved).length;
  }

  function renderSaved() {
    var list = $('saved-list');
    list.textContent = '';
    var items = Object.keys(state.saved).map(function (id) { return state.saved[id]; })
      .sort(function (a, b) { return b.savedAt - a.savedAt; });
    $('saved-empty').hidden = items.length > 0;
    items.forEach(function (it) {
      var d = it.deal;
      var li = el('li', 'saved-item');
      li.appendChild(visual(d, 'thumb'));
      var body = el('div', 'body');
      body.appendChild(el('p', 'brand-line', d.brand === d.store ? d.brand : d.brand + ' · ' + d.store));
      body.appendChild(el('p', 'name', d.name));
      var pr = el('p', 'prices');
      pr.appendChild(el('span', 'now', money(d.price)));
      if (T.isDeal(d)) {
        pr.appendChild(el('span', 'was', money(d.was)));
        pr.appendChild(el('span', 'pct', '-' + T.discountPct(d) + '%'));
      }
      body.appendChild(pr);
      body.appendChild(el('p', 'sub small', 'Saved ' + new Date(it.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
        '. Price as of ' + fmtDate(data.updated || '') + ', so recheck before buying.'));
      var row = el('div', 'row');
      var url = T.safeUrl(d.url);
      if (url) {
        var a = el('a', 'btn small', 'Open listing');
        a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        row.appendChild(a);
      }
      var rm = el('button', 'btn ghost small', 'Remove');
      rm.addEventListener('click', function () {
        delete state.saved[d.id];
        persist(); renderSaved(); renderSavedCount();
      });
      row.appendChild(rm);
      body.appendChild(row);
      li.appendChild(body);
      list.appendChild(li);
    });
  }

  // ---------- taste ----------
  function renderBars(ul, rows, max) {
    ul.textContent = '';
    if (!rows.length) {
      ul.appendChild(el('li', 'sub', 'Not enough swipes yet.'));
      return;
    }
    rows.slice(0, 7).forEach(function (r) {
      var li = el('li');
      li.appendChild(el('span', 'lbl', r.label));
      var bar = el('span', 'bar');
      var fill = el('i');
      fill.style.width = Math.max(6, Math.min(100, Math.abs(r.w) / max * 100)) + '%';
      bar.appendChild(fill);
      li.appendChild(bar);
      ul.appendChild(li);
    });
  }

  function renderTaste() {
    var vals = Object.keys(state.seen).map(function (k) { return state.seen[k]; });
    $('stat-saved').textContent = vals.filter(function (v) { return v === 'save'; }).length;
    $('stat-passed').textContent = vals.filter(function (v) { return v === 'pass'; }).length;
    var s = T.summarize(state.weights);
    var max = 0;
    s.likes.concat(s.dislikes).forEach(function (r) { max = Math.max(max, Math.abs(r.w)); });
    max = Math.max(max, 1);
    renderBars($('likes'), s.likes, max);
    renderBars($('dislikes'), s.dislikes, max);
  }

  function profileText() {
    var s = T.summarize(state.weights);
    var names = function (act) {
      return Object.keys(state.seen).filter(function (id) { return state.seen[id] === act; })
        .map(function (id) { var d = dealById(id) || data.deals.filter(function (x) { return x.id === id; })[0]; return d ? d.brand + ' ' + d.name + ' (' + money(d.price) + ')' : id; });
    };
    return JSON.stringify({
      app: 'Style Swipe taste profile',
      exported: new Date().toISOString().slice(0, 10),
      leaningToward: s.likes.slice(0, 10).map(function (r) { return r.label + ' (' + r.w.toFixed(1) + ')'; }),
      leaningAwayFrom: s.dislikes.slice(0, 10).map(function (r) { return r.label + ' (' + r.w.toFixed(1) + ')'; }),
      saved: names('save'),
      passed: names('pass')
    }, null, 2);
  }

  function copyProfile() {
    var text = profileText();
    var status = $('copy-status');
    function fallback() {
      var ta = $('copy-fallback');
      ta.hidden = false; ta.value = text; ta.focus(); ta.select();
      status.textContent = 'Select all and copy the text below.';
    }
    try {
      navigator.clipboard.writeText(text).then(function () {
        status.textContent = 'Copied. Paste it to Claude.';
      }, fallback);
    } catch (e) { fallback(); }
  }

  var resetArmed = false;
  function resetTaste() {
    var btn = $('reset');
    if (!resetArmed) {
      resetArmed = true; btn.textContent = 'Tap again to erase swipes and saved items';
      setTimeout(function () { resetArmed = false; btn.textContent = 'Reset my taste'; }, 4000);
      return;
    }
    state = { seen: {}, weights: Object.assign({}, T.PRIORS), history: [], saved: {} };
    persist(); resetArmed = false; btn.textContent = 'Reset my taste';
    rebuildQueue(false); renderDeck(); renderSavedCount(); renderTaste(); renderSaved();
  }

  // ---------- navigation ----------
  function show(view) {
    ['swipe', 'saved', 'taste'].forEach(function (v) {
      $('view-' + v).classList.toggle('is-active', v === view);
      var tab = $('tab-' + v);
      tab.classList.toggle('is-active', v === view);
      tab.setAttribute('aria-selected', v === view ? 'true' : 'false');
    });
    if (view === 'saved') renderSaved();
    if (view === 'taste') renderTaste();
  }

  function init() {
    load();
    document.querySelectorAll('.gender-mode').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.gender === genderFilter);
      b.setAttribute('aria-pressed', b.dataset.gender === genderFilter ? 'true' : 'false');
      b.addEventListener('click', function () {
        genderFilter = b.dataset.gender;
        try { localStorage.setItem('styleSwipe.department', genderFilter); } catch (e) {}
        document.querySelectorAll('.gender-mode').forEach(function (x) {
          x.classList.toggle('is-active', x === b);
          x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
        });
        rebuildQueue(false); renderDeck();
      });
    });
    document.querySelectorAll('.feed-mode').forEach(function (b) {
      b.addEventListener('click', function () {
        feedMode = b.dataset.mode;
        document.querySelectorAll('.feed-mode').forEach(function (x) { x.classList.toggle('is-active', x === b); });
        rebuildQueue(false); renderDeck();
      });
    });
    $('category-filter').addEventListener('change', function (e) { categoryFilter = e.target.value; rebuildQueue(false); renderDeck(); });
    $('price-filter').addEventListener('change', function (e) { priceFilter = e.target.value; rebuildQueue(false); renderDeck(); });
    $('brand-filter').addEventListener('change', function (e) { brandFilter = e.target.value; rebuildQueue(false); renderDeck(); });
    $('label-filter').addEventListener('change', function (e) { labelFilter = e.target.value; rebuildQueue(false); renderDeck(); });
    document.querySelectorAll('.tab').forEach(function (b) {
      b.addEventListener('click', function () { show(b.dataset.view); });
    });
    $('btn-save').addEventListener('click', function () { fling('save'); });
    $('btn-pass').addEventListener('click', function () { fling('pass'); });
    $('btn-undo').addEventListener('click', undo);
    $('reshow').addEventListener('click', function () {
      Object.keys(state.seen).forEach(function (id) { if (state.seen[id] === 'pass') delete state.seen[id]; });
      persist(); rebuildQueue(false); renderDeck();
    });
    $('copy-profile').addEventListener('click', copyProfile);
    $('reset').addEventListener('click', resetTaste);
    document.addEventListener('keydown', function (e) {
      if (!$('view-swipe').classList.contains('is-active')) return;
      if (e.key === 'ArrowRight') fling('save');
      else if (e.key === 'ArrowLeft') fling('pass');
      else if (e.key === 'z' || e.key === 'Z') undo();
    });
    renderSavedCount();

    var timer = setTimeout(function () { fail(); }, 10000);
    fetch('deals.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (j) {
      clearTimeout(timer);
      data.updated = j.updated || '';
      data.deals = (j.deals || []).filter(function (d) {
        return d && d.id && d.name && d.brand && d.store && T.isWearable(d) && T.safeUrl(d.url) && T.safeUrl(d.image) &&
          Number.isFinite(d.price) && d.price > 0 && (!Number.isFinite(d.was) || d.was >= d.price);
      });
      var brands = Array.from(new Set(data.deals.map(function (d) { return d.brand; }))).sort();
      brands.forEach(function (name) { var option = el('option', '', name); option.value = name; $('brand-filter').appendChild(option); });
      rebuildQueue(false);
      renderDeck();
    }).catch(function () { clearTimeout(timer); fail(); });

    function fail() {
      var e = $('load-error');
      e.hidden = false; e.dataset.on = '1';
      $('updated').textContent = 'Offline';
      $('empty').hidden = true;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
