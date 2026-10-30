/*
 * Earlier readings of a device brought onto a station — `window.TerrySenseHistory(get, post)`,
 * `get` and `post` being tb_io's. When a station starts storing measurements of a device, the
 * device may hold readings from before: `survey` says what it holds per channel, `copy` copies a
 * period of it under the station's channel names. A channel takes only readings newer than its
 * own newest, so its series never interleaves two sources (CHANNEL_MAP.md §1). Written through
 * the REST API, the copies reach the station's chain as TIMESERIES_UPDATED, which it drops: no
 * alarm, no notification (MIGRATION_LESSONS.md §2). `TerrySenseHistory.offer` is the dialog.
 * Spec: logr-product-docs/cloud/DEVICE_VIEW.md §2 *Earlier readings*.
 *
 * Loads after resolver.js, ui.js and tb_io.js.
 */
(function (root) {
'use strict';

var PAGE = 5000;
var DAY_MS = 86400000;
var PERIODS = { day: 1, week: 7, month: 30 };

function series(entity) { return '/api/plugins/telemetry/' + entity.entityType + '/' + entity.id; }

/** `{channel: sourceKey}`: the entries of `after` fed by `deviceId` that `before` did not have, same source. */
function added(before, after, deviceId) {
  var out = {};
  Object.keys(after || {}).forEach(function (c) {
    var a = after[c], b = (before || {})[c];
    if (a.device === deviceId && !(b && b.device === a.device && b.key === a.key)) { out[c] = a.key; }
  });
  return out;
}

/** The start of a period: `day`, `week`, `month`, `all`, or a `YYYY-MM-DD` local day. */
function periodStart(period, at) {
  if (period === 'all') { return 0; }
  if (PERIODS[period]) { return at - PERIODS[period] * DAY_MS; }
  var d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period || '');
  return d ? new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3])).getTime() : null;
}

/** The calculated names fed, directly or through one another, by `channels`. */
function calculatedFrom(channels, names) {
  var fed = {}, found = [], more = true;
  channels.forEach(function (c) { fed[c] = true; });
  while (more) {
    var fresh = Object.keys(names).filter(function (n) {
      var calc = (names[n] || {}).calculated;
      return calc && !fed[n] && (calc.channels || []).some(function (c) { return fed[c]; });
    });
    fresh.forEach(function (n) { fed[n] = true; found.push(n); });
    more = fresh.length > 0;
  }
  return found;
}

root.TerrySenseHistory = function (get, post) {

  function edge(entity, keys, end, order) {
    return get(series(entity) + '/values/timeseries', { keys: keys.join(','), startTs: '0', endTs: String(end), limit: '1', agg: 'NONE', orderBy: order })
      .then(function (res) {
        var out = {};
        keys.forEach(function (k) { var p = res && res[k] && res[k][0]; if (p && p.value !== null) { out[k] = Number(p.ts); } });
        return out;
      });
  }

  /** Per channel of `channels` (`{channel: sourceKey}`), what `device` held before `at`: `[{channel, key, first, last, stationLast}]`,
   * `first` and `last` null when it held nothing, `stationLast` the station's newest reading of the channel before `at`. */
  function survey(device, station, channels, at) {
    var names = Object.keys(channels).sort(), keys = names.map(function (c) { return channels[c]; });
    if (!names.length) { return Promise.resolve([]); }
    return Promise.all([edge(device, keys, at, 'ASC'), edge(device, keys, at, 'DESC'), edge(station, names, at, 'DESC')]).then(function (got) {
      return names.map(function (c) {
        var k = channels[c];
        return { channel: c, key: k, first: got[0][k] || null, last: got[1][k] || null, stationLast: got[2][c] || null };
      });
    });
  }

  /** Where a row's copy starts for a period starting `from`: after the station's newest reading of the channel. */
  function startOf(row, from) { return row.stationLast ? Math.max(from, row.stationLast + 1) : from; }

  /** Copy the readings of `rows` (from `survey`) between `from` and `at` onto the station, with `ttlS` seconds
   * of retention when set; `progress(copied)` after each page. Resolves the number of readings copied. */
  function copy(device, station, rows, from, at, ttlS, progress) {
    var target = series(station) + '/timeseries/ANY' + (ttlS ? '/' + ttlS : ''), total = 0;
    function page(row, start) {
      if (start > at) { return Promise.resolve(); }
      return get(series(device) + '/values/timeseries', { keys: row.key, startTs: String(start), endTs: String(at), limit: String(PAGE),
        agg: 'NONE', orderBy: 'ASC', useStrictDataTypes: 'true' }).then(function (res) {
        var pts = ((res && res[row.key]) || []).filter(function (p) { return p.value !== null && p.value !== undefined; });
        if (!pts.length) { return null; }
        var body = pts.map(function (p) { var v = {}; v[row.channel] = p.value; return { ts: Number(p.ts), values: v }; });
        return post(target, body).then(function () {
          total += pts.length;
          if (progress) { progress(total); }
          return pts.length < PAGE ? null : page(row, Number(pts[pts.length - 1].ts) + 1);
        });
      });
    }
    var work = Promise.resolve();
    rows.forEach(function (row) {
      if (!row.last || row.last < startOf(row, from)) { return; }
      work = work.then(function () { return page(row, startOf(row, from)); });
    });
    return work.then(function () { return total; });
  }

  return { survey: survey, copy: copy, startOf: startOf };
};

root.TerrySenseHistory.added = added;
root.TerrySenseHistory.periodStart = periodStart;
root.TerrySenseHistory.calculatedFrom = calculatedFrom;

/**
 * Offer to copy the earlier readings of `device` (`{entityType, id, name}`) onto `station` for the channels it
 * now feeds there and did not before, `before` and `after` the station's map entries around the save made at
 * `at`; `names` the vocabulary. Nothing is shown when the device holds no reading for them. Resolves true once
 * readings are copied, false when declined or failed, null when there is nothing to copy.
 */
root.TerrySenseHistory.offer = function (ui, tb, station, device, before, after, at, names) {
  var t = root.TerrySenseT, h = ui.h, esc = ui.esc;
  var io = root.TerrySenseHistory(tb.get, tb.post);
  var channels = added(before, after, device.id);
  if (!Object.keys(channels).length) { return Promise.resolve(null); }
  function fail(err) {
    ui.toast(t('history.failed', 'Readings not copied: {error}', { error: (err && (err.message || (err.error && err.error.message))) || String(err) }), 'error');
    return false;
  }

  function day(ts) {
    var locale = t.locale(), d = new Date(ts);
    return d.toLocaleDateString(locale || undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function isoDay(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  return Promise.all([io.survey(device, station, channels, at), tb.attrsMap(station)]).then(function (got) {
    var rows = got[0].filter(function (r) { return r.last; }), attrs = got[1];
    if (!rows.length) { return null; }
    var oldest = Math.min.apply(null, rows.map(function (r) { return r.first; }));
    var calculated = root.TerrySenseResolver.calculatedChannels(after, attrs, names || {});
    var unfilled = calculatedFrom(rows.map(function (r) { return r.channel; }), names || {}).filter(function (n) { return calculated.indexOf(n) >= 0; });
    var ttlDays = Number(attrs['effective.ttlDays']);
    // The same retention station_project stamps on a live reading.
    var ttlS = ttlDays > 0 ? Math.round(ttlDays * DAY_MS / 1000) : 0;

    return new Promise(function (resolve) {
      var el = h('<div class="ts-confirm" data-dialog="history"><div class="ts-confirm-box ts-history-box"><p></p>' +
        '<div class="ts-field"><div class="ts-field-label"><span></span></div><div class="ts-ctl">' +
        '<select class="ts-select wide" data-f="period"></select></div>' +
        '<div class="ts-ctl" data-f="sinceRow" hidden><input class="ts-input wide" type="date" data-f="since"></div></div>' +
        '<ul class="ts-history-rows"></ul><p class="ts-field-hint" data-f="notes"></p>' +
        '<div class="ts-confirm-actions"><button type="button" class="ts-btn" data-a="no"></button>' +
        '<button type="button" class="ts-btn primary" data-a="yes"></button></div></div></div>');
      el.querySelector('p').innerHTML = t('history.intro', '{device} holds readings from before it fed {station}. Copy those of a period onto the station?',
        { device: '<b>' + esc(device.name) + '</b>', station: '<b>' + esc(station.name) + '</b>' });
      el.querySelector('.ts-field-label span').textContent = t('history.period', 'Period');
      var periodSel = el.querySelector('[data-f=period]'), since = el.querySelector('[data-f=since]');
      [['day', t('history.day', 'Last 24 hours')], ['week', t('history.week', 'Last 7 days')], ['month', t('history.month', 'Last 30 days')],
       ['since', t('history.since', 'Since a date…')], ['all', t('history.all', 'Everything it holds, since {date}', { date: day(oldest) })]].forEach(function (o) {
        var opt = periodSel.appendChild(document.createElement('option'));
        opt.value = o[0];
        opt.textContent = o[1];
      });
      periodSel.value = 'week';
      since.value = isoDay(Math.max(oldest, at - PERIODS.week * DAY_MS));
      since.max = isoDay(at);
      var notes = [t('history.noAlarm', 'Copied readings raise no alarm and notify nobody.')];
      if (unfilled.length) {
        notes.push(t('history.calculated', 'Calculated channels are not computed for the copied period: {list}.',
          { list: unfilled.map(function (n) { return root.TerrySenseMapping.channelLabel(names, n); }).join(', ') }));
      }
      el.querySelector('[data-f=notes]').textContent = notes.join(' ');
      var list = el.querySelector('.ts-history-rows'), yes = el.querySelector('[data-a=yes]');

      function from() { return root.TerrySenseHistory.periodStart(periodSel.value === 'since' ? since.value : periodSel.value, at); }

      function render() {
        el.querySelector('[data-f=sinceRow]').hidden = periodSel.value !== 'since';
        var start = from();
        list.innerHTML = '';
        var any = false;
        rows.forEach(function (r) {
          var li = list.appendChild(h('<li><b></b> <span class="ts-mono"></span> <span class="ts-row-meta"></span></li>'));
          li.setAttribute('data-channel', r.channel);
          li.querySelector('b').textContent = root.TerrySenseMapping.channelLabel(names || {}, r.channel);
          li.querySelector('.ts-mono').textContent = '← ' + r.key;
          var begins = start === null ? null : io.startOf(r, start), meta = li.querySelector('.ts-row-meta');
          if (begins === null) { return; }
          if (r.last < begins) { meta.textContent = t('history.nothing', 'nothing to copy in this period'); return; }
          any = true;
          meta.textContent = r.stationLast && begins > start
            ? t('history.after', 'from {date}, after the readings the channel holds', { date: ui.when(begins) })
            : t('history.from', 'from {date}', { date: ui.when(Math.max(begins, r.first)) });
        });
        yes.disabled = !any;
      }
      periodSel.addEventListener('change', render);
      since.addEventListener('change', render);
      el.querySelector('[data-a=no]').textContent = t('history.notNow', 'Not now');
      yes.textContent = t('history.copy', 'Copy readings');
      el.querySelector('[data-a=no]').addEventListener('click', function () { el.remove(); resolve(false); });
      yes.addEventListener('click', function () {
        var start = from();
        if (start === null) { return; }
        yes.disabled = true;
        el.querySelector('[data-a=no]').disabled = true;
        io.copy(device, station, rows, start, at, ttlS, function (n) {
          yes.textContent = t('history.copying', 'Copying… {n}', { n: n });
        }).then(function (n) {
          el.remove();
          ui.toast(t('history.copied', '{n} readings copied to {station}', { n: n, station: station.name }));
          resolve(n > 0);
        }).catch(function (err) {
          el.remove();
          resolve(fail(err));
        });
      });
      render();
      ui.card().appendChild(el);
    });
  }).catch(fail);
};

if (typeof module !== 'undefined' && module.exports) { module.exports = root.TerrySenseHistory; }

})(typeof window !== 'undefined' ? window : globalThis);
