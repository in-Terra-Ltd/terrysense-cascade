/*
 * terrySense widget UI kit — `window.TerrySenseUi(rootEl)` returns helpers
 * bound to one widget's root element. Styles are shared/theme.css; wording is
 * shared/glossary.js.
 *
 * The tooltip is one element on document.body, styled inline: ThingsBoard
 * prefixes widget CSS with the widget's own scope, and a tooltip inside the
 * widget would be clipped by its card.
 */
(function (root) {
'use strict';

// Tenant public images, by lower-case device type.
var PRODUCT_IMAGES = {
  logr4: '/api/images/public/MV2thHN69nM3RPzhnSOCvGluKYPRahrV',
  logr2: '/api/images/public/5R9sxOWP2LwdjGai84MW8AVI0bn8vAFn',
  whtr: '/api/images/public/kus0O9cD6msP6ZU2A8WVpQbwMhfsLgGJ',
  'zc-tilt': '/api/images/public/y2xMghNuSOdCDuurIrOv1VibfHVbUyVO',
  gsaa: '/api/images/public/euA57c3EzeGXPzUeAaAcGSmrkbWWCVZs',
  gsaa2: '/api/images/public/euA57c3EzeGXPzUeAaAcGSmrkbWWCVZs'
};
// [good from, fair from]; a spreading factor is compared negated, lower being better.
var RADIO_LEVELS = { rssi: [-100, -115], snr: [0, -10], sf: [-8, -10] };

var ICON = {
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="6" height="16" rx="1"/><path d="M9 8h6M9 16h6"/><rect x="15" y="5" width="6" height="6" rx="1"/><rect x="15" y="13" width="6" height="6" rx="1"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
  chev: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  down: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>',
  gauge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4-5"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10h14V9M10 13h4"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  install: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 9.5-4.9M18 11v5l2 2H8"/><path d="M10 20a2 2 0 0 0 4 0M3 3l18 18"/></svg>'
};

// The state chips of FRONTEND.md *Interface conventions*; `silenced` reads its time.
function chipText(kind) {
  return {
    retired: root.TerrySenseT('common.retired', 'Archived'), outofservice: root.TerrySenseT('common.outOfService', 'Out of service'),
    'private': root.TerrySenseT('common.private', 'Private'), nodevice: root.TerrySenseT('ui.chip.nodevice', 'No device yet'),
    waiting: root.TerrySenseT('ui.chip.waiting', 'Waiting for the link')
  }[kind];
}
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function clock(ts) {
  var d = new Date(ts);
  return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}

/** "15:00" today, "3 Oct 15:00" another day; the day in the reader's locale when known. */
function when(ts) {
  var d = new Date(ts), locale = root.TerrySenseT.locale();
  if (d.toDateString() === new Date().toDateString()) { return clock(ts); }
  return (locale ? d.toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : d.getDate() + ' ' + MONTHS[d.getMonth()]) + ' ' + clock(ts);
}

function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

/** Lower case, accents dropped: what a search compares. */
function fold(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }

function h(html) {
  var t = document.createElement('template');
  t.innerHTML = String(html).trim();
  return t.content.firstChild;
}

function camelKind(kind) { return root.TerrySenseResolver.camelKind(kind); }

// -- tooltip: one per page -----------------------------------------------------

function tooltipEl() {
  var el = document.getElementById('ts-tooltip');
  if (el) { return el; }
  el = document.createElement('div');
  el.id = 'ts-tooltip';
  el.setAttribute('role', 'tooltip');
  el.style.cssText = 'position:fixed;z-index:100000;max-width:300px;padding:8px 10px;background:#18313f;color:#fff;' +
    'border-radius:4px;font:12px/1.45 "Segoe UI",system-ui,sans-serif;pointer-events:none;opacity:0;transition:opacity .12s;';
  document.body.appendChild(el);
  return el;
}

function showTip(target) {
  var el = tooltipEl();
  var key = target.getAttribute('data-tip');
  var term = root.TerrySenseGlossary.TERMS[key];
  if (term) { el.innerHTML = term; } else { el.textContent = key; }
  el.style.opacity = '1';
  var r = target.getBoundingClientRect(), tr = el.getBoundingClientRect();
  var left = Math.min(Math.max(8, r.left + r.width / 2 - tr.width / 2), window.innerWidth - tr.width - 8);
  var top = r.bottom + 6;
  if (top + tr.height > window.innerHeight - 8) { top = r.top - tr.height - 6; }
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}

function hideTip() { tooltipEl().style.opacity = '0'; }

// -- the kit ---------------------------------------------------------------------

root.TerrySenseUi = function (rootEl) {
  var glossary = root.TerrySenseGlossary;

  rootEl.addEventListener('mouseover', function (e) { var t = e.target.closest('[data-tip]'); if (t) { showTip(t); } });
  rootEl.addEventListener('mouseout', function (e) { if (e.target.closest('[data-tip]')) { hideTip(); } });
  rootEl.addEventListener('focusin', function (e) { var t = e.target.closest('[data-tip]'); if (t) { showTip(t); } });
  rootEl.addEventListener('focusout', hideTip);

  function info(key) { return '<span class="ts-info" tabindex="0" data-tip="' + esc(key) + '">' + ICON.info + '</span>'; }
  function sevDot(id) { return '<span class="ts-dot" style="background:var(--sev-' + esc(id) + ')"></span>'; }

  /** The colour picked for a project or a station, its `config.color`; terrySense blue without one. A hex
   * colour, as Leaflet writes it into SVG attributes, where no CSS variable resolves. */
  function markerColor(attrs) {
    var c = attrs && attrs['config.color'];
    return /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#0277b7';
  }

  /** A map marker in `color`, `text` inside it, ringed in `ring`, the state, and the silenced badge. */
  function pin(color, text, ring, silenced) {
    return '<span class="ts-pin' + (ring ? ' ring' : '') + (silenced ? ' silenced' : '') + '" style="--c:' + color + (ring ? ';--r:' + ring : '') + '"><b>' + esc(text) + '</b>' +
      (silenced ? '<i class="ts-pin-badge">' + ICON.mute + '</i>' : '') + '</span>';
  }

  function card() { return rootEl.querySelector('.ts-card') || rootEl; }

  function toast(text, kind) {
    var el = h('<div class="ts-toast' + (kind === 'error' ? ' error' : '') + '">' + (kind === 'error' ? ICON.info : ICON.check) + '<span></span></div>');
    el.querySelector('span').textContent = text;
    card().appendChild(el);
    setTimeout(function () { el.remove(); }, kind === 'error' ? 6000 : 2600);
  }

  /** Resolves true/false. `html` is trusted markup built by the caller. With `check`
   * ({label, checked}) the box carries a switch that keeps `check.checked`, and `html`
   * may be a function of it, rebuilt on each toggle. */
  function confirm(html, okLabel, check) {
    return new Promise(function (resolve) {
      var el = h('<div class="ts-confirm"><div class="ts-confirm-box"><p></p>' +
        (check ? '<label class="ts-switch ts-confirm-check"><input type="checkbox" data-f="check"> <span></span></label>' : '') +
        '<div class="ts-confirm-actions">' +
        '<button type="button" class="ts-btn" data-a="no"></button><button type="button" class="ts-btn primary" data-a="yes"></button></div></div></div>');
      el.querySelector('[data-a=no]').textContent = root.TerrySenseT('common.cancel', 'Cancel');
      var p = el.querySelector('p');
      var fill = function () { p.innerHTML = typeof html === 'function' ? html(check ? check.checked : false) : html; };
      fill();
      if (check) {
        var box = el.querySelector('[data-f=check]');
        box.checked = !!check.checked;
        el.querySelector('.ts-confirm-check span').textContent = check.label;
        box.addEventListener('change', function () { check.checked = box.checked; fill(); });
      }
      el.querySelector('[data-a=yes]').textContent = okLabel;
      el.addEventListener('click', function (e) {
        var a = e.target.getAttribute('data-a');
        if (a) { el.remove(); resolve(a === 'yes'); }
      });
      card().appendChild(el);
    });
  }

  function closeDrawer() {
    card().querySelectorAll('.ts-drawer, .ts-drawer-backdrop').forEach(function (n) { n.remove(); });
  }

  /** A side panel over the card. Returns `{el, body, foot, onBack(fn)}`. */
  function openDrawer(titleHtml, subtitleHtml) {
    closeDrawer();
    var back = h('<div class="ts-drawer-backdrop"></div>');
    var dr = h('<div class="ts-drawer"><div class="ts-head"><button type="button" class="ts-icon-btn ts-back" hidden title="' +
      esc(root.TerrySenseT('ui.back', 'Back')) + '">' + ICON.back + '</button>' +
      '<div class="ts-head-text"><div class="ts-title"></div><div class="ts-subtitle"></div></div>' +
      '<button type="button" class="ts-icon-btn ts-x" title="' + esc(root.TerrySenseT('ui.close', 'Close')) + '">' + ICON.close + '</button></div>' +
      '<div class="ts-body"></div><div class="ts-foot" hidden></div></div>');
    dr.querySelector('.ts-title').innerHTML = titleHtml;
    dr.querySelector('.ts-subtitle').innerHTML = subtitleHtml || '';
    back.addEventListener('click', closeDrawer);
    dr.querySelector('.ts-x').addEventListener('click', closeDrawer);
    // Below the navigation row: ThingsBoard's fullscreen button floats over the card's top right corner.
    var nav = card().querySelector(':scope > .ts-nav');
    if (nav) { back.style.top = dr.style.top = nav.offsetHeight + 'px'; }
    card().appendChild(back);
    card().appendChild(dr);
    return {
      el: dr,
      body: dr.querySelector('.ts-body'),
      foot: dr.querySelector('.ts-foot'),
      onBack: function (fn) {
        var b = dr.querySelector('.ts-back');
        b.hidden = false;
        b.addEventListener('click', fn);
      }
    };
  }

  /** Footer with Cancel + primary action; returns the primary button. */
  function drawerActions(drawer, label) {
    drawer.foot.hidden = false;
    drawer.foot.innerHTML = '<span class="ts-spacer"></span><button type="button" class="ts-btn"></button><button type="button" class="ts-btn primary"></button>';
    drawer.foot.querySelector('.ts-btn').textContent = root.TerrySenseT('common.cancel', 'Cancel');
    drawer.foot.querySelector('.ts-btn').addEventListener('click', closeDrawer);
    var primary = drawer.foot.querySelector('.primary');
    primary.textContent = label || root.TerrySenseT('common.save', 'Save');
    return primary;
  }

  /** A floating list under `anchor`, inside the card; closes on an outside click. */
  function popover(anchor, contentEl) {
    card().querySelectorAll('.ts-popover').forEach(function (p) { p.remove(); });
    var pop = h('<div class="ts-popover"></div>');
    pop.appendChild(contentEl);
    card().appendChild(pop);
    var cr = card().getBoundingClientRect(), br = anchor.getBoundingClientRect();
    var width = pop.offsetWidth;
    pop.style.left = Math.max(8, Math.min(br.left - cr.left, cr.width - width - 8)) + 'px';
    var top = br.bottom - cr.top + 4;
    if (top + pop.offsetHeight > cr.height - 8) { top = Math.max(8, br.top - cr.top - pop.offsetHeight - 4); }
    pop.style.top = top + 'px';
    function off(e) {
      if (!pop.contains(e.target) && !anchor.contains(e.target)) { close(); }
    }
    function close() { pop.remove(); document.removeEventListener('mousedown', off, true); }
    document.addEventListener('mousedown', off, true);
    return { el: pop, close: close };
  }

  function nameOption(name, entry, side, cls) {
    var o = h('<div class="ts-opt' + (cls ? ' ' + cls : '') + '" tabindex="0"><div class="ts-opt-main"><div class="ts-opt-label"></div><div class="ts-opt-desc"></div></div>' +
      '<div class="ts-opt-side">' + (side || '') + '<span class="ts-mono"></span></div></div>');
    o.querySelector('.ts-opt-label').textContent = entry.label || name;
    o.querySelector('.ts-opt-desc').textContent = entry.description || '';
    o.querySelector('.ts-mono').textContent = name;
    return o;
  }

  /**
   * Channel names grouped by kind, with search, "only names in use" and a
   * diagnostics toggle. opts: {names, kinds, allowKind(kindSpec) -> bool,
   * inUse: [name], badge(name) -> html, onPick(name)}.
   */
  function namePicker(opts) {
    var names = opts.names || {}, kinds = opts.kinds || {};
    var inUse = opts.inUse || [];
    var t = root.TerrySenseT;
    var el = h('<div><div class="ts-search">' + ICON.search + '<input class="ts-input" placeholder="' +
      esc(t('ui.picker.search', 'Search measurements')) + '"></div>' +
      '<div class="ts-picker-opts"></div><div class="ts-picker-list"></div></div>');
    var input = el.querySelector('input');
    var optsEl = el.querySelector('.ts-picker-opts');
    var list = el.querySelector('.ts-picker-list');
    var onlyInUse = inUse.length > 0;
    var showDiag = false;

    if (inUse.length) {
      optsEl.appendChild(h('<label class="ts-switch"><input type="checkbox" class="o-inuse" checked> ' + esc(t('ui.picker.onlyInUse', 'Only names in use here')) + ' ' + info('inUse') + '</label>'));
    }
    optsEl.appendChild(h('<label class="ts-switch"><input type="checkbox" class="o-diag"> ' + esc(t('ui.picker.diagnostics', 'Device diagnostics')) + ' ' + info('diagnostics') + '</label>'));
    optsEl.addEventListener('change', function (e) {
      if (e.target.classList.contains('o-inuse')) { onlyInUse = e.target.checked; }
      if (e.target.classList.contains('o-diag')) { showDiag = e.target.checked; }
      render();
    });
    input.addEventListener('input', render);

    function kindOf(name) { return camelKind((names[name] || {}).kind) || ''; }
    function kindSpec(camel) {
      var keys = Object.keys(kinds);
      for (var i = 0; i < keys.length; i++) { if (camelKind(keys[i]) === camel) { return kinds[keys[i]]; } }
      return null;
    }

    function shown(n) {
      var e = names[n] || {};
      return { label: e.label ? t.channel(n, e.label) : '', description: e.description ? t.channelInfo(n, e.description) : '' };
    }

    function render() {
      var q = input.value.trim().toLowerCase();
      var groups = {};
      Object.keys(names).forEach(function (n) {
        var entry = names[n] || {}, text = shown(n);
        var camel = kindOf(n);
        var spec = kindSpec(camel);
        if (opts.allowKind && !opts.allowKind(spec)) { return; }
        if (entry.aboutHardware && !showDiag && !q) { return; }
        if (onlyInUse && !q && inUse.indexOf(n) < 0) { return; }
        var kindLabel = spec ? t.kind(camel, spec.label) : (camel || t('common.unknownKind', 'Unknown measurement kind'));
        var hay = (n + ' ' + text.label + ' ' + text.description + ' ' + kindLabel).toLowerCase();
        if (q && hay.indexOf(q) < 0) { return; }
        (groups[camel] = groups[camel] || { label: kindLabel, names: [] }).names.push(n);
      });
      list.innerHTML = '';
      Object.keys(groups).sort(function (a, b) { return groups[a].label.localeCompare(groups[b].label); }).forEach(function (camel) {
        var g = groups[camel];
        g.names.sort(function (a, b) {
          return (inUse.indexOf(b) >= 0) - (inUse.indexOf(a) >= 0) || (shown(a).label || a).localeCompare(shown(b).label || b);
        });
        var det = h('<details class="ts-group"><summary><span class="ts-chev">' + ICON.chev + '</span><span></span> <span class="ts-count"></span></summary></details>');
        det.querySelector('summary span:nth-child(2)').textContent = g.label;
        det.querySelector('.ts-count').textContent = g.names.length;
        if (q || onlyInUse || g.names.length <= 3) { det.open = true; }
        g.names.forEach(function (n) {
          var side = (inUse.indexOf(n) >= 0 ? '<span class="ts-chip accent">' + esc(t('ui.picker.inUseChip', 'in use')) + '</span>' : '') + (opts.badge ? opts.badge(n) : '');
          var o = nameOption(n, shown(n), side);
          o.addEventListener('click', function () { opts.onPick(n); });
          o.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { opts.onPick(n); } });
          det.appendChild(o);
        });
        list.appendChild(det);
      });
      if (!list.children.length) {
        list.appendChild(h('<div class="ts-empty"></div>'));
        list.firstChild.textContent = onlyInUse && !q
          ? t('ui.picker.noMatchInUse', 'No measurement matches — untick “Only names in use here” to see every name.')
          : t('ui.picker.noMatch', 'No measurement matches.');
      }
    }
    render();
    setTimeout(function () { input.focus(); }, 0);
    return el;
  }

  /**
   * A list to pick one entry from (FRONTEND.md *Interface conventions*, Pick lists). opts: {key(item),
   * text(item) what the search reads, option(item) the row element, onPick(item), filters [{id, label,
   * test(item), on}], sorts [{id, label, compare(a, b), group(item)}] the first the default, a group naming
   * the heading an entry falls under; top [{key, label}] fixed rows above the list, placeholder, empty}.
   * Returns {el, set(items)}; null items read as loading.
   */
  function pickList(opts) {
    var t = root.TerrySenseT, filters = opts.filters || [], sorts = opts.sorts || [], items = null;
    var el = h('<div class="ts-pick"><div class="ts-pick-bar"><div class="ts-search">' + ICON.search + '<input class="ts-input" type="search" data-f="search"></div>' +
      '<label class="ts-pick-sort"><span></span><select class="ts-select" data-f="sort"></select></label></div>' +
      '<div class="ts-picker-opts"></div><div class="ts-pick-count"></div><div class="ts-pick-list"></div></div>');
    var input = el.querySelector('input'), sortSel = el.querySelector('select'), list = el.querySelector('.ts-pick-list');
    input.placeholder = opts.placeholder || t('ui.pick.search', 'Search');
    el.querySelector('.ts-pick-sort span').textContent = t('ui.pick.sortBy', 'Sort by');
    sorts.forEach(function (s) { sortSel.appendChild(h('<option></option>')).textContent = s.label; sortSel.lastChild.value = s.id; });
    el.querySelector('.ts-pick-sort').hidden = sorts.length < 2;
    var optsEl = el.querySelector('.ts-picker-opts');
    filters.forEach(function (f) {
      var sw = optsEl.appendChild(h('<label class="ts-switch"><input type="checkbox"> <span></span></label>'));
      sw.querySelector('input').setAttribute('data-f', f.id);
      sw.querySelector('input').checked = !!f.on;
      sw.querySelector('span').textContent = f.label;
      sw.querySelector('input').addEventListener('change', function (e) { f.on = e.target.checked; render(); });
    });
    input.addEventListener('input', render);
    sortSel.addEventListener('change', render);
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') { return; }
      var rows = list.querySelectorAll('[data-pick]');
      if (rows.length === 1) { rows[0].click(); }
    });
    (opts.top || []).forEach(function (x) {
      var o = el.insertBefore(h('<div class="ts-opt ts-pick-top" tabindex="0"><div class="ts-opt-main"><div class="ts-opt-label"></div></div></div>'), list);
      o.setAttribute('data-pick', x.key);
      o.querySelector('.ts-opt-label').textContent = x.label;
      o.addEventListener('click', function () { opts.onPick(x); });
      o.addEventListener('keydown', function (e) { if (e.key === 'Enter') { opts.onPick(x); } });
    });

    // A filter that would keep nothing is left out, so it never empties the list.
    function live(f) { return items.some(f.test); }

    function render() {
      list.innerHTML = '';
      var count = el.querySelector('.ts-pick-count');
      if (!items) {
        el.querySelector('.ts-pick-bar').hidden = optsEl.hidden = count.hidden = true;
        list.appendChild(h('<div class="ts-loading"></div>')).textContent = t('common.loading', 'Loading…');
        return;
      }
      var active = filters.filter(function (f) {
        var on = live(f);
        optsEl.querySelector('[data-f="' + f.id + '"]').parentNode.hidden = !on;
        return on && f.on;
      });
      optsEl.hidden = !filters.some(live);
      // Short lists need neither: their entries are all in view.
      el.querySelector('.ts-pick-bar').hidden = items.length <= 8;
      var words = fold(input.value).split(/\s+/).filter(Boolean);
      var sort = sorts.filter(function (s) { return s.id === sortSel.value; })[0] || sorts[0];
      var shown = items.filter(function (x) {
        if (active.some(function (f) { return !f.test(x); })) { return false; }
        var hay = fold(opts.text(x));
        return words.every(function (w) { return hay.indexOf(w) >= 0; });
      });
      if (sort) { shown.sort(sort.compare); }
      count.hidden = shown.length === items.length;
      count.textContent = t('device.nOf', '{n} of {total}', { n: shown.length, total: items.length });
      var heading = null;
      shown.forEach(function (x) {
        var g = sort && sort.group ? sort.group(x) : null;
        if (g !== null && g !== heading) { list.appendChild(h('<div class="ts-subhead"></div>')).textContent = g; }
        heading = g;
        var o = list.appendChild(opts.option(x));
        o.setAttribute('data-pick', opts.key(x));
        o.addEventListener('click', function () { opts.onPick(x); });
        o.addEventListener('keydown', function (e) { if (e.key === 'Enter') { opts.onPick(x); } });
      });
      if (!shown.length) {
        list.appendChild(h('<div class="ts-empty"></div>')).textContent = !items.length ? opts.empty || t('ui.pick.none', 'Nothing to pick.')
          : active.length ? t('ui.pick.noMatchFiltered', 'Nothing matches: clear a filter to see more.') : t('ui.pick.noMatch', 'Nothing matches.');
      }
    }
    render();
    return {
      el: el,
      set: function (next) {
        items = next;
        render();
        if (items && !el.querySelector('.ts-pick-bar').hidden) { setTimeout(function () { input.focus(); }, 0); }
      }
    };
  }

  /**
   * A field holding one pick: a button naming it, opening `pickList(opts)` under it. `opts.name(item)` names
   * the picked entry, `opts.none` the button before a pick. Returns {el, set(items), value(), pick(key)}; the
   * button fires `change` on each pick.
   */
  function pickField(opts) {
    var items = null, picked = null, top = opts.top || [], open = null;
    var el = h('<button type="button" class="ts-select wide ts-pick-field"><span class="ts-grow"></span>' + ICON.down + '</button>');
    function show() { el.firstChild.textContent = !picked ? opts.none : top.indexOf(picked) >= 0 ? picked.label : opts.name(picked); }
    function pick(x) {
      picked = x;
      show();
      el.dispatchEvent(new Event('change'));
    }
    el.addEventListener('click', function () {
      var pop, box = open = pickList(Object.assign({}, opts, { onPick: function (x) { pop.close(); pick(x); } }));
      pop = popover(el, box.el);
      pop.el.classList.add('ts-pick-pop');
      box.set(items);
    });
    show();
    return {
      el: el,
      set: function (next) {
        items = next;
        if (open && open.el.isConnected) { open.set(items); }
      },
      value: function () { return picked; },
      pick: function (key) {
        var x = top.filter(function (i) { return i.key === key; })[0] || (items || []).filter(function (i) { return opts.key(i) === key; })[0];
        if (x) { pick(x); }
        return !!x;
      }
    };
  }

  /** The tenant's public image of a device type, or null. */
  function productImage(type) { return PRODUCT_IMAGES[String(type || '').toLowerCase()] || null; }

  /** good | fair | poor: RSSI, SNR and spreading factor by their thresholds (DEVICE_VIEW.md §2). */
  function radioLevel(kind, v) {
    var t = RADIO_LEVELS[kind], n = kind === 'sf' ? -Number(v) : Number(v);
    return !isFinite(n) ? null : n >= t[0] ? 'good' : n >= t[1] ? 'fair' : 'poor';
  }

  /** A value coloured by its radio level. */
  function metric(text, level) {
    var el = h('<span class="ts-radio"></span>');
    el.textContent = text;
    if (level) { el.dataset.level = level; }
    return el;
  }

  /**
   * The ⋯ button of a row or a view header (FRONTEND.md *Interface conventions*).
   * `items`, or a function returning them when the menu opens: `{a, label,
   * run(), danger?, tenantOnly?}`, falsy ones skipped. Tenant-only items follow
   * under a *Tenant only* heading when `opts.tenant`, and are absent otherwise.
   */
  function rowMenu(items, opts) {
    opts = opts || {};
    var btn = h('<button type="button" class="ts-icon-btn ts-menu-btn" data-a="menu">' + ICON.more + '</button>');
    btn.title = opts.title || root.TerrySenseT('ui.actions', 'Actions');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var list = (typeof items === 'function' ? items() : items).filter(Boolean);
      var box = h('<div class="ts-menu" role="menu"></div>');
      var pop;
      function add(i) {
        var b = box.appendChild(h('<button type="button" class="ts-menu-item" role="menuitem"></button>'));
        b.setAttribute('data-a', i.a);
        b.textContent = i.label;
        if (i.danger) { b.classList.add('danger'); }
        b.addEventListener('click', function () { pop.close(); i.run(); });
      }
      list.filter(function (i) { return !i.tenantOnly; }).forEach(add);
      var tenant = opts.tenant ? list.filter(function (i) { return i.tenantOnly; }) : [];
      if (tenant.length) {
        box.appendChild(h('<div class="ts-menu-head"></div>')).textContent = root.TerrySenseT('common.tenantOnly', 'Tenant only');
        tenant.forEach(add);
      }
      pop = popover(btn, box);
      pop.el.classList.add('ts-menu-pop');
    });
    return btn;
  }

  /** A *Tenant only* block for a form or panel, holding `node`: add it only for the tenant. */
  function tenantSection(node) {
    var el = h('<div class="ts-tenant-only"><div class="ts-section-head"></div></div>');
    el.firstChild.textContent = root.TerrySenseT('common.tenantOnly', 'Tenant only');
    el.appendChild(node);
    return el;
  }

  /** "Silenced until 15:00", or "Silenced until 3 Oct 15:00" another day. */
  function silenceText(until) { return root.TerrySenseT('ui.silencedUntil', 'Silenced until {time}', { time: when(until) }); }

  /** A state chip: `retired`, `outofservice`, `private`, `nodevice`, or `silenced` with its end. */
  function stateChip(kind, until) {
    var el = h('<span class="ts-chip ts-state-chip"></span>');
    el.setAttribute('data-chip', kind);
    el.textContent = kind === 'silenced' ? silenceText(until) : chipText(kind);
    if (kind === 'silenced') { el.insertAdjacentHTML('afterbegin', ICON.mute); }
    return el;
  }

  /** The *Pending* chip of an alarm raised but not notified yet (ALARMING.md §2.5), or null. */
  function pendingChip(alarm) {
    var d = (alarm && alarm.details) || {};
    if (!d.pending) { return null; }
    var p = { count: Number(d.count) || 1, debounce: Number(d.debounce) || 1 };
    p.n = Math.max(p.debounce - p.count, 1);
    var el = h('<span class="ts-chip ts-state-chip" data-chip="pending"></span>');
    el.textContent = root.TerrySenseT('ui.chip.pending', 'Pending {count} of {debounce}', p);
    el.setAttribute('data-tip', p.n === 1
      ? root.TerrySenseT('ui.pendingNext', 'Raised, nobody notified yet: {count} of {debounce} readings in a row past the threshold. Its contacts are notified at the next one past it.', p)
      : root.TerrySenseT('ui.pendingMore', 'Raised, nobody notified yet: {count} of {debounce} readings in a row past the threshold. Its contacts are notified after {n} more past it.', p));
    return el;
  }

  /**
   * The follow-up card after a structural action: one row per step, each
   * `{a, label, done, action, run()}`, a done one ticked. `onDismiss` hides it.
   */
  function followUp(title, steps, onDismiss) {
    var el = h('<div class="ts-followup"><div class="ts-followup-head"><b></b><span class="ts-spacer"></span>' +
      '<button type="button" class="ts-icon-btn" data-a="dismiss" title="' + esc(root.TerrySenseT('ui.dismiss', 'Dismiss')) + '">' + ICON.close + '</button></div></div>');
    el.querySelector('b').textContent = title;
    el.querySelector('[data-a=dismiss]').addEventListener('click', function () { el.remove(); onDismiss(); });
    steps.forEach(function (s) {
      var row = el.appendChild(h('<div class="ts-followup-step"><span class="ts-followup-mark"></span><span class="ts-grow"></span></div>'));
      row.setAttribute('data-step', s.a);
      row.querySelector('.ts-grow').textContent = s.label;
      if (s.done) {
        row.classList.add('done');
        row.firstChild.innerHTML = ICON.check;
        return;
      }
      var b = row.appendChild(h('<button type="button" class="ts-btn ghost"></button>'));
      b.textContent = s.action;
      b.addEventListener('click', s.run);
    });
    return el;
  }

  /**
   * A confirmation gated by typing `name`, with an optional checkbox off by
   * default. Resolves null on cancel, else `{checked}`.
   */
  function confirmTyped(html, name, okLabel, checkLabel) {
    return new Promise(function (resolve) {
      var el = h('<div class="ts-confirm"><div class="ts-confirm-box"><p></p>' +
        (checkLabel ? '<label class="ts-switch ts-confirm-check"><input type="checkbox" data-f="check"> <span></span></label>' : '') +
        '<div class="ts-field"><div class="ts-field-hint ts-confirm-type"></div><input class="ts-input wide" data-f="typed"></div>' +
        '<div class="ts-confirm-actions"><button type="button" class="ts-btn" data-a="no"></button>' +
        '<button type="button" class="ts-btn primary danger" data-a="yes" disabled></button></div></div></div>');
      el.querySelector('p').innerHTML = html;
      el.querySelector('[data-a=no]').textContent = root.TerrySenseT('common.cancel', 'Cancel');
      if (checkLabel) { el.querySelector('.ts-confirm-check span').textContent = checkLabel; }
      el.querySelector('.ts-confirm-type').textContent = root.TerrySenseT('ui.typeToConfirm', 'Type {name} to confirm.', { name: name });
      var yes = el.querySelector('[data-a=yes]'), typed = el.querySelector('[data-f=typed]');
      yes.textContent = okLabel;
      typed.addEventListener('input', function () { yes.disabled = typed.value.trim() !== name; });
      el.addEventListener('click', function (e) {
        var a = e.target.getAttribute('data-a');
        if (!a) { return; }
        el.remove();
        resolve(a === 'yes' ? { checked: checkLabel ? el.querySelector('[data-f=check]').checked : false } : null);
      });
      card().appendChild(el);
      setTimeout(function () { typed.focus(); }, 0);
    });
  }

  /** Edit `target`'s text in place: Enter or leaving the field saves through
   * `save(value)` (a Promise), Escape cancels. */
  function inlineEdit(target, value, save) {
    var input = h('<input class="ts-input ts-inline-edit">');
    input.value = value;
    target.textContent = '';
    target.appendChild(input);
    var done = false;
    function finish(keep) {
      if (done) { return; }
      done = true;
      var v = input.value.trim();
      if (!keep || !v || v === value) { target.textContent = value; return; }
      target.textContent = v;
      save(v).catch(function (err) {
        target.textContent = value;
        toast(root.TerrySenseT('ui.notRenamed', 'Not renamed: {error}', { error: (err && err.message) || err }), 'error');
      });
    }
    input.addEventListener('click', function (e) { e.stopPropagation(); });
    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') { finish(true); }
      if (e.key === 'Escape') { finish(false); }
    });
    input.addEventListener('blur', function () { finish(true); });
    setTimeout(function () { input.focus(); input.select(); }, 0);
    return input;
  }

  return {
    rowMenu: rowMenu, tenantSection: tenantSection, stateChip: stateChip, pendingChip: pendingChip, silenceText: silenceText, when: when,
    followUp: followUp, confirmTyped: confirmTyped, inlineEdit: inlineEdit,
    productImage: productImage, radioLevel: radioLevel, metric: metric,
    ICON: ICON, esc: esc, h: h, info: info, sevDot: sevDot, markerColor: markerColor, pin: pin, glossary: glossary,
    toast: toast, confirm: confirm, card: card, openDrawer: openDrawer, closeDrawer: closeDrawer,
    drawerActions: drawerActions, popover: popover, namePicker: namePicker, nameOption: nameOption, pickList: pickList, pickField: pickField
  };
};

})(typeof self !== 'undefined' ? self : this);
