/*
 * Project data export (CA-24) — `window.TerrySenseExport(get)`, `get(url,
 * params)` being tb_io's. Every station's readings over its whole history and
 * what reads them, as one ZIP built in the browser as the signed-in user.
 * Loads after resolver.js. Layout: logr-product-docs/cloud/FRONTEND.md *Project data export*;
 * terrysense/operations/archive.py writes the same.
 */
(function (root) {
'use strict';

var PAGE = 10000;
var JSZIP = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';

function field(v) {
  var s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** `series` maps a channel to its points `[{ts, value}]`, `units` a channel to its unit: one row per timestamp, oldest first. */
function toCsv(series, units) {
  var channels = Object.keys(series).sort();
  var rows = {};
  channels.forEach(function (c, i) {
    series[c].forEach(function (p) { (rows[p.ts] || (rows[p.ts] = []))[i] = p.value; });
  });
  var lines = [['time'].concat(channels.map(function (c) { return units[c] ? c + ' [' + units[c] + ']' : c; })).map(field).join(',')];
  Object.keys(rows).map(Number).sort(function (a, b) { return a - b; }).forEach(function (ts) {
    var cells = [new Date(ts).toISOString()];
    for (var i = 0; i < channels.length; i++) { cells.push(field(rows[ts][i])); }
    lines.push(cells.join(','));
  });
  return lines.join('\r\n') + '\r\n';
}

function fileName(name, taken) {
  var base = String(name).replace(/[\\/:*?"<>|]/g, '-').trim() || 'station', n = 1, out = base;
  while (taken[out.toLowerCase()]) { out = base + ' (' + (++n) + ')'; }
  taken[out.toLowerCase()] = true;
  return out;
}

function parseJson(raw) {
  if (raw == null) { return null; }
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return null; }
}

function num(v) { return v == null || v === '' || !isFinite(Number(v)) ? null : Number(v); }

/** A channel's label and unit: the station's own, else its name's in the vocabulary, else its kind's cloud unit. */
function channelMeta(c, attrs, meta) {
  var R = root.TerrySenseResolver, k = R.splitChannelKey(c), name = meta.names[k.name] || {};
  return {
    label: attrs['effective.' + c + '.label'] || (name.label ? name.label + (k.instance ? ' ' + k.instance : '') : null),
    unit: attrs['effective.' + c + '.unit'] || name.unit || (name.kind && R.kindSpec(name.kind, meta.kinds).cloudUnit) || null
  };
}

/** What reads a station's CSV: its position, its state, and each channel's label and unit. Never a contact or a setting. */
function stationInfo(station, attrs, file, channels, meta) {
  var out = { name: station.name, file: file, latitude: num(attrs.latitude), longitude: num(attrs.longitude),
    retired: attrs['service.state'] === 'retired', channels: {} };
  channels.forEach(function (c) { out.channels[c] = channelMeta(c, attrs, meta); });
  return out;
}

function loadZip() {
  if (root.JSZip) { return Promise.resolve(root.JSZip); }
  return new Promise(function (resolve, reject) {
    var el = document.createElement('script');
    el.src = JSZIP;
    el.onload = function () { resolve(root.JSZip); };
    el.onerror = function () { reject(new Error('could not load ' + JSZIP)); };
    document.head.appendChild(el);
  });
}

root.TerrySenseExport = function (get) {

  /** Every point of one key, oldest first: ThingsBoard caps each read at `limit` points per key. */
  function history(entity, key, now, stopped) {
    var url = '/api/plugins/telemetry/' + entity.entityType + '/' + entity.id + '/values/timeseries';
    var points = [];
    function page(start) {
      if (stopped()) { return Promise.reject({ cancelled: true }); }
      return get(url, { keys: key, startTs: String(start), endTs: String(now), limit: String(PAGE), agg: 'NONE', orderBy: 'ASC' }).then(function (res) {
        var got = (res && res[key]) || [];
        Array.prototype.push.apply(points, got);
        return got.length < PAGE ? points : page(Number(got[got.length - 1].ts) + 1);
      });
    }
    return page(0);
  }

  /** `project` with its attributes, `stations` `[{station, attrs}]`; `opts.meta` the vocabulary `{names, kinds}`,
   * `opts.progress(done, total, name)`, `opts.stopped()` true to cancel. Resolves path to text, under one folder named after the project. */
  function collect(project, projectAttrs, stations, opts) {
    var now = Date.now(), taken = {}, folder = fileName(project.name, {}) + '/';
    var files = {}, infos = [];
    var stopped = opts.stopped || function () { return false; };
    var meta = opts.meta || { names: {}, kinds: {} };
    var work = Promise.resolve();
    stations.forEach(function (s, i) {
      work = work.then(function () {
        if (opts.progress) { opts.progress(i, stations.length, s.station.name); }
        return get('/api/plugins/telemetry/' + s.station.entityType + '/' + s.station.id + '/keys/timeseries');
      }).then(function (keys) {
        var series = {};
        var reads = Promise.resolve();
        (keys || []).forEach(function (k) {
          reads = reads.then(function () { return history(s.station, k, now, stopped); }).then(function (pts) { series[k] = pts; });
        });
        return reads.then(function () {
          var file = fileName(s.station.name, taken) + '.csv';
          var info = stationInfo(s.station, s.attrs || {}, file, Object.keys(series).sort(), meta);
          var units = {};
          Object.keys(info.channels).forEach(function (c) { units[c] = info.channels[c].unit; });
          files[folder + file] = toCsv(series, units);
          infos.push(info);
        });
      });
    });
    return work.then(function () {
      files[folder + 'project.json'] = JSON.stringify({ project: project.name, perimeter: parseJson(projectAttrs.perimeter),
        exportedAt: new Date(now).toISOString(), stations: infos }, null, 2) + '\n';
      if (opts.progress) { opts.progress(stations.length, stations.length, ''); }
      return files;
    });
  }

  /** `collect`, zipped: resolves `{blob, fileName}`, the project's name and the day. */
  function build(project, projectAttrs, stations, opts) {
    return Promise.all([loadZip(), collect(project, projectAttrs, stations, opts)]).then(function (got) {
      var zip = new got[0]();
      Object.keys(got[1]).forEach(function (path) { zip.file(path, got[1][path]); });
      var name = fileName(project.name, {}) + ' ' + new Date().toISOString().slice(0, 10) + '.zip';
      return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }).then(function (blob) { return { blob: blob, fileName: name }; });
    });
  }

  return { collect: collect, build: build };
};

root.TerrySenseExport.toCsv = toCsv;

if (typeof module !== 'undefined' && module.exports) { module.exports = root.TerrySenseExport; }

})(typeof window !== 'undefined' ? window : globalThis);
