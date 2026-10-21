/*
 * Device — one device of any type: is it live, what it measures and which
 * station channel each measurement feeds (TC-1 to TC-7); for a user who may
 * write it, connecting it to a station, a new one included, and choosing the
 * channels (CA-1), per station or per measurement, and on a LOGR3 or LOGR4 the commands that reconfigure it
 * (CA-4, TC-8/9). Read-only for anyone else.
 *
 * In its header, for the same user, *Silence* (CA-19) and the device's row
 * menu: *Replace device…* (CA-13), *Out of service…* or *Back in service*
 * (CA-23). After a replacement, a follow-up card lists what is still to do.
 *
 * Laid out in three levels (FRONTEND.md *Interface conventions*, Disclosure):
 * the verdict and one summary line per area (battery, radio, reporting, SD
 * card), the raw values in a closed *Details*; then one measurement table, a
 * header per position or sensor stating its verdict and a line per measurement,
 * its source keys, wiring and controls in a closed *Configure* at the foot of
 * each position, beside a rail of the stations and the device-wide *Configure*
 * or the register. Every closed part opens as its reader last left it. Below
 * 720 px one column, each measurement a list item. The layout depends on the family:
 *   bus    LOGR3, LOGR4: positions from `topology.p<POS>.*`, position 0 from
 *          the LOGR's own catalog entry; sources from `subscriptions.*` and
 *          the stored telemetry keys, each with its interval, its reporting
 *          rule and whether it is enabled, or *not subscribed*; configurable
 *          by command, the rule's triggers limited to its kind's. A DRYC
 *          adds the readings unpacked from its status and its rules state.
 *   logr2  the LOGR and its one or two sensors, fixed in its firmware:
 *          readings grouped by their peripheral prefix; the data of a sensor
 *          no longer used can be deleted; the register.
 *   other  any other device: its readings in one card; the register.
 *
 * A bus source's state is its latest reading: a value newer than its
 * `<sourceKey>.status` is OK, otherwise the status code is the fault the
 * device stated (HEALTH.md §1). Faults counted in the header are the device's
 * active `peripheralFault.*` alarms. A command is written as `cmd.request`;
 * `dl_dispatch` merges it into `cmd.pending` and sends the whole set, and
 * `dl_ack` turns the answer into `cmd.lastResult` (DOWNLINK.md).
 *
 * Connecting writes the STATION -> DEVICE `Contains` relation, the station's
 * `config.channelMap`, then a resolve. A station keeps one source device (CHANNEL_MAP.md §3), so connecting to a
 * station fed by another device replaces it and keeps the channels this one
 * reports. The dry contact interface's channels belong to the station's DRYC
 * view and are kept. Widget: logr-product-docs/cloud/DEVICE_VIEW.md.
 *
 * `opts`, set by build_device_dashboard.py: `projectDashboardId`, whose Station
 * view a station opens and whose Dry contact interface view the DRYC card opens,
 * and `devicesDashboardId`.
 *
 * Loads after shared/resolver.js, glossary.js, ui.js, tb_io.js, calculations.js and lifecycle.js.
 */

window.TerrySenseDeviceTopology = function (ctx, container, opts) {

opts = opts || {};

var t = window.TerrySenseI18n(ctx);
var resolver = window.TerrySenseResolver;
var G = window.TerrySenseGlossary;
var tb = window.TerrySenseTbIo(ctx);
var root = container.querySelector('.ts-root') || container;
var ui = window.TerrySenseUi(root);
var life = window.TerrySenseLifecycle(ui, tb);
var calc = window.TerrySenseCalculations(ui, tb);
var h = ui.h, esc = ui.esc, ICON = ui.ICON, info = ui.info, metric = ui.metric;
var camel = resolver.camelKind;
var M = window.TerrySenseMapping;

var FAULT_PREFIX = 'peripheralFault.';
var REFRESH_MS = 60000;
var LIVE_POLL_MS = 600000;
var LIVE_SETTLE_MS = 1000;
var HOUR_MS = 3600000;
var DAY_MS = 86400000;
var BATTERY_VOLTAGE = ['p0.voltage', 'logr.batteryVoltage'];
// The LOGR's power inputs, named as the vocabulary names chargerSource's states.
function powerSources() {
  function s(token, english) { return t.state('chargerSource', token, english); }
  return { usb: s('usb', 'USB'), sp_int: s('sp_int', 'internal solar'), sp_ext: s('sp_ext', 'external solar'), bus: s('bus', 'bus'), none: s('none', 'none') };
}
// A STATUS carrying the POWERBOARD fault holds no power reading: soc, sources and estimates are not reported (TRX_NANO.md §8).
function powerUnread(c) { return (parseJson(c['status.healthFaults']) || []).indexOf('POWERBOARD') >= 0; }
// A STATUS field the LOGR sent unknown holds no reading either (ATTRIBUTES.md §2).
var UNKNOWN = 'unknown';
function sdStates() { return { ready: t('device.sdReady', 'ready'), fault: t('device.sdFault', 'fault'), not_inserted: t('device.sdNoCard', 'no card') }; }
var NEW_STATION = '__new';
// A source is silent past this many of its intervals (HEALTH.md §2).
var NOT_READINGS = M.NOT_READINGS, RULE_SOURCE = M.RULE_SOURCE, DRYC_KEY = M.DRYC_KEY, LOGR2_SENSORS = M.LOGR2_SENSORS;
function register() {
  return [
    { key: 'register.hwVersion', label: t('device.regHwVersion', 'Hardware version') },
    { key: 'register.hwStatus', label: t('device.regHwStatus', 'Hardware status') },
    { key: 'register.loraFw', label: t('device.regLoraFw', 'LoRa module firmware') },
    { key: 'register.dfu', label: t('device.regDfu', 'Firmware update (DFU)'), flag: true }
  ];
}
var FINE_STATUS = /^(all functional|ok|)$/i;
var ICON_DEVICE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6"/></svg>';
var ICON_STATION = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V9"/><path d="M8 21h8"/><circle cx="12" cy="6" r="3"/></svg>';
var parseSource = M.parseSource;

/** `ph` -> `PH`, `drycStatus` -> `DRYC_STATUS`: the wire kind the encoder takes. */
function wireKind(kind) { return String(kind).replace(/([A-Z])/g, '_$1').toUpperCase(); }

function sourceTarget(s) {
  var t = { mode: 'SOURCE', position: s.position, kind: wireKind(s.kind) };
  if (s.hasGroup) { t.group = s.group; }
  if (s.hasIndex) { t.index = s.index; }
  return t;
}

function parseJson(raw) {
  if (!raw) { return null; }
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return null; }
}

function fmtDuration(sec) {
  var s = Number(sec);
  if (!isFinite(s)) { return String(sec); }
  if (s < 120) { return Math.round(s) + ' s'; }
  if (s < 7200) { return Math.round(s / 60) + ' min'; }
  if (s < 172800) { return Math.round(s / 3600) + ' h'; }
  return t('common.days', '{n} days', { n: Math.round(s / 86400) });
}

function fmtValue(v) {
  if (v === true || v === 'true') { return t('common.valueOn', 'on'); }
  if (v === false || v === 'false') { return t('common.valueOff', 'off'); }
  var n = Number(v);
  if (v === '' || v === null || isNaN(n)) { return String(v); }
  return String(Math.round(n * 1000) / 1000);
}

function rssiLevel(v) { return ui.radioLevel('rssi', v); }
function snrLevel(v) { return ui.radioLevel('snr', v); }
function sfLevel(v) { return ui.radioLevel('sf', v); }

function errText(err) { return (err && (err.message || (err.error && err.error.message))) || String(err); }

// -- data -------------------------------------------------------------------------------

var state = {
  device: null, client: {}, server: {}, latest: {}, faults: {}, peripherals: {}, kinds: {}, names: {},
  loadedAt: 0, writable: false, me: null,
  bindings: [], wiring: {}, calcAttributes: {}, followUp: null,
  // all | attention | unstored; the subscription changes by source key and the measurements added, sent together.
  filter: 'all', draft: {}, adds: []
};
var memo = window.TerrySenseDisclosure('device');
/** A place of this device, remembered apart from the same place on another device. */
function placeOf(place) { return state.device.id.id + '.' + place; }

function deviceEntity() {
  return { entityType: 'DEVICE', id: state.device.id.id, name: state.device.name, label: state.device.label,
           ownerId: state.device.ownerId && state.device.ownerId.id };
}

/** bus | logr2 | other: how the device is laid out and what it lets change. */
function family() {
  if (tb.isComplexDevice(state.device.type)) { return 'bus'; }
  return state.device.type === 'logr2' ? 'logr2' : 'other';
}

function loadDefaults() {
  return tb.io.fetchDefaults().then(function (d) { return d ? tb.attrsMap(d) : {}; }).then(function (a) {
    state.peripherals = parseJson(a['config.peripherals']) || {};
    state.kinds = parseJson(a['config.kinds']) || {};
    state.names = parseJson(a['config.channelNames']) || {};
    state.calcAttributes = parseJson(a['config.calcAttributes']) || {};
  });
}

function loadDevice(id) {
  var dev = { entityType: 'DEVICE', id: id };
  return Promise.all([
    tb.get('/api/device/' + id),
    tb.attrsMap(dev, 'CLIENT_SCOPE'),
    tb.attrsMap(dev, 'SERVER_SCOPE'),
    tb.get('/api/plugins/telemetry/DEVICE/' + id + '/keys/timeseries').catch(function () { return []; }),
    tb.get('/api/alarm/DEVICE/' + id, { searchStatus: 'ACTIVE', pageSize: '100', page: '0' }).catch(function () { return null; })
  ]).then(function (got) {
    state.device = got[0];
    state.client = got[1];
    state.server = got[2];
    state.faults = {};
    ((got[4] && got[4].data) || []).forEach(function (a) {
      if (a.type.indexOf(FAULT_PREFIX) === 0) { state.faults[a.type.slice(FAULT_PREFIX.length)] = a; }
    });
    var keys = M.latestKeys(family() === 'bus', tb.readingKeys(got[3]));
    if (!keys.length) { return {}; }
    return tb.get('/api/plugins/telemetry/DEVICE/' + id + '/values/timeseries', { keys: keys.join(',') });
  }).then(function (latest) {
    state.latest = {};
    Object.keys(latest || {}).forEach(function (k) {
      var p = latest[k] && latest[k][0];
      if (p) { state.latest[k] = { ts: Number(p.ts), value: p.value }; }
    });
    return loadBindings(id);
  }).then(function () {
    state.loadedAt = Date.now();
  });
}

/** The Stations that contain the device, each with its channel map and whether
 * the user may write it; and which station channel each source feeds (TC-2,
 * CHANNEL_MAP.md). */
function loadBindings(id) {
  var query = {
    parameters: { rootId: id, rootType: 'DEVICE', direction: 'TO', relationTypeGroup: 'COMMON', maxLevel: 1, fetchLastLevelOnly: false },
    filters: [{ relationType: 'Contains', entityTypes: ['ASSET'] }]
  };
  return tb.post('/api/relations', query).then(function (rels) {
    return Promise.all((rels || []).map(function (r) { return tb.getAsset(r.from.id); }));
  }).then(function (assets) {
    return Promise.all(assets.filter(function (a) { return a && a.type === 'Station'; }).map(function (a) {
      var station = tb.assetLevel(a);
      station.ownerId = a.ownerId && a.ownerId.id;
      return Promise.all([tb.attrsMap(station), tb.canWrite(station)]).then(function (got) {
        return { station: station, attrs: got[0], entries: resolver.mapEntries(got[0]['config.channelMap']), writable: got[1] };
      });
    }));
  }).then(function (list) {
    state.bindings = list.sort(function (a, b) { return a.station.name.localeCompare(b.station.name); });
    state.wiring = {};
    list.forEach(function (b) {
      var channels = mineOf(b.entries);
      Object.keys(channels).forEach(function (key) {
        (state.wiring[channels[key]] = state.wiring[channels[key]] || []).push({
          station: b.station.name, channel: key, label: b.attrs['effective.' + key + '.label'] || ''
        });
      });
    });
  }).catch(function () { state.bindings = []; state.wiring = {}; });
}

// -- model ------------------------------------------------------------------------------

function model() {
  return { bus: family() === 'bus', device: state.device, client: state.client, latest: state.latest, faults: state.faults,
           peripherals: state.peripherals, kinds: state.kinds, names: state.names };
}
function topology() { return M.topology(model()); }
function sources() { return M.sources(model()); }

/** ok | fault | waiting | disabled, from the latest value and status of one source. */
function sourceState(s) {
  var v = state.latest[s.sourceKey], st = state.latest[s.sourceKey + '.status'];
  if (st && (!v || st.ts >= v.ts)) { return { state: 'fault', code: String(st.value), ts: st.ts }; }
  if (v) { return { state: 'ok', value: v.value, ts: v.ts }; }
  if (s.enabled === false || s.enabled === 'false') { return { state: 'disabled' }; }
  return { state: 'waiting' };
}

function measureOf(s, node) { return M.measureOf(model(), s, node); }
function sourceLabel(s, node) { return M.sourceLabel(model(), s, node); }
function unitOf(s) { return M.unitOf(model(), s); }
function readings() { return M.readings(model()); }
function nameOf(key) { return M.nameOf(model(), key); }
function entryOf(key) { return M.entryOf(model(), key); }
function labelOf(key) { return M.labelOf(model(), key); }
function readingUnit(key) { return M.readingUnit(model(), key); }
var logr2Parts = M.logr2Parts;

/** The names this device's channels carry on its stations. */
function mappedNames() { return M.mappedNames(state.device.id.id, state.bindings.map(function (b) { return b.entries; })); }
function namesForKind(kind) { return M.namesForKind(model(), kind, mappedNames()); }
function mappable() { return M.mappable(model(), mappedNames()); }

// -- commands (CA-4, TC-8/9) ---------------------------------------------------------------

function parseValue(raw) { return typeof raw === 'string' ? parseJson(raw) : raw; }

/** The changes the device has not acknowledged, or null; past its window the set is unanswered. */
function pending() {
  var p = parseValue(state.server['cmd.pending']);
  if (!p || !(p.commands || []).length) { return null; }
  var interval = Number(state.client['status.baseIntervalSeconds']) || 0;
  var window = Math.max(DAY_MS, 2 * interval * 1000);
  var sent = Number(p.updatedAt || p.issuedAt) || 0;
  return { commands: p.commands, frames: (p.frames || []).length, sent: sent, unanswered: Date.now() - sent > window };
}

function targetText(tg) {
  if (!tg || tg.mode === 'GLOBAL' || !tg.mode) { return ''; }
  if (tg.mode === 'POSITION') { return t('device.targetPosition', ' at position {pos}', { pos: tg.position }); }
  return t('device.targetSource', ' of {source}', {
    source: 'p' + tg.position + '.' + camel(tg.kind) + (tg.group ? '.g' + tg.group : '') + (tg.index ? '.i' + tg.index : '')
  });
}

function commandText(c) {
  var target = targetText(c.target);
  var what = {
    SET_INTERVAL: (c.target || {}).mode === 'GLOBAL' ? t('device.cmdUplinkInterval', 'Uplink interval → {s} s', { s: c.interval_s })
      : t('device.cmdInterval', 'Interval{target} → {s} s', { target: target, s: c.interval_s }),
    SET_ENABLED: c.enabled ? t('device.cmdEnable', 'Enable{target}', { target: target }) : t('device.cmdDisable', 'Disable{target}', { target: target }),
    SELF_DIAG: t('device.selfDiag', 'Self-diagnostic'),
    REQUEST_REPORT: t('device.requestReports', 'Request reports') + (c.reports ? ': ' + c.reports.join(', ') : ''),
    CREATE_SUBSCRIPTION: t('device.cmdSubscribe', 'Send{target} every {s} s', { target: target, s: c.interval_s }),
    DELETE_SUBSCRIPTION: t('device.cmdUnsubscribe', 'Stop sending{target}', { target: target }),
    PERIPHERAL_OP: t('device.cmdPeripheralOp', 'Peripheral operation{target}', { target: target }),
    SET_TRIGGER: c.trigger === 'none' ? t('device.cmdTriggerNone', 'Report{target} on its schedule only', { target: target })
      : t('device.cmdTrigger', 'Report{target} at once {rule}', { target: target, rule: ruleText(c.trigger, c.min_interval_s, c.level, unitOfTarget(c.target)) })
  }[c.op];
  return what || String(c.op);
}

/** A reporting rule in words (reporting_rules.md): `when it turns on, at most every 15 min`. */
function ruleText(trigger, minInterval, level, unit) {
  var lv = fmtValue(level) + (unit ? ' ' + unit : '');
  var what = {
    rise: t('device.ruleRise', 'when it turns on'),
    fall: t('device.ruleFall', 'when it turns off'),
    change: t('device.ruleChange', 'when it changes'),
    above: t('device.ruleAbove', 'when it rises above {level}', { level: lv }),
    below: t('device.ruleBelow', 'when it falls below {level}', { level: lv })
  }[trigger] || String(trigger);
  return Number(minInterval) > 0 ? t('device.ruleAtMost', '{rule}, at most every {d}', { rule: what, d: fmtDuration(minInterval) }) : what;
}

function unitOfTarget(tg) { return tg && tg.kind ? unitOf({ kind: tg.kind }) : ''; }

function resultText(r) {
  if (r.status !== 'OK') { return r.opcode + ': ' + (G.COMMAND_STATUS[r.status] || r.status); }
  if (r.applied_interval_s !== undefined) { return r.opcode + ': ' + t('device.resultInterval', 'OK, now {s} s', { s: r.applied_interval_s }); }
  if (r.selfdiag_faults) {
    return r.opcode + ': ' + (r.selfdiag_faults.length ? t('device.resultFaults', 'faults {list}', { list: r.selfdiag_faults.join(', ') }) : t('device.resultHealthy', 'all healthy'));
  }
  return r.opcode + ': OK';
}

function listOf(commands) { return '<ul>' + commands.map(function (c) { return '<li>' + esc(commandText(c)) + '</li>'; }).join('') + '</ul>'; }

function deviceName() { return '<b>' + esc(state.device.label || state.device.name) + '</b>'; }

/** Writes `cmd.request`; `dl_dispatch` merges it into the queued set and replaces the device's queue. */
function request(body, toast) {
  body.by = (state.me && state.me.email) || null;
  body.issuedAt = Date.now();
  return tb.saveAttrs(deviceEntity(), { 'cmd.request': body }).then(function () {
    ui.toast(toast);
    ui.closeDrawer();
    if (!(live && live.healthy())) { setTimeout(refresh, 1500); }
    return true;
  }).catch(function (err) {
    ui.toast(t('common.notSent', 'Not sent: {error}', { error: err && (err.message || (err.error && err.error.message)) || err }), 'error');
    return false;
  });
}

/** When the next uplink is planned, and a warning when the set leaves no measurement that makes the device transmit. */
function uplinkNote(commands) {
  var at = nextUplink(), uplink = Number(state.client['status.baseIntervalSeconds']);
  var all = ((pending() || {}).commands || []).concat(commands);
  var note = !at ? '' : ' ' + (at > Date.now() ? t('device.nextUplinkPlanned', 'Its next uplink is planned by {time}.', { time: ui.when(at) })
    : t('device.nextUplinkLate', 'Its next uplink was due by {time}.', { time: ui.when(at) }));
  if (uplink && txGap(uplink).data !== null && txGap(uplink, all).data === null) {
    note += ' ' + t('device.goesQuiet', 'After these changes no measurement makes it transmit; it transmits at least once a day: the link check. A later change waits up to a day.');
  }
  return note;
}

/** `note`, when given, follows the list of commands. With `choice` ({label, checked}) the
 * confirmation carries that switch, and `commands` and `note` are functions of it. */
function send(commands, note, choice) {
  var queued = pending();
  var n = queued ? queued.commands.length : 0;
  var cmds = function (on) { return choice ? commands(on) : commands; };
  var html = function (on) {
    var nt = choice ? note(on) : note;
    return t('device.sendTo', 'Send to {device}?', { device: deviceName() }) + listOf(cmds(on)) + (nt ? nt + ' ' : '') +
      (n === 1 ? t('device.queueJoinOne', 'It joins the 1 queued change; the whole set goes out after the device’s next uplink.')
         : n ? t('device.queueJoinMany', 'It joins the {n} queued changes; the whole set goes out after the device’s next uplink.', { n: n })
         : t('device.deliveredNext', 'It is delivered after the device’s next uplink.')) + uplinkNote(cmds(on));
  };
  return ui.confirm(choice ? html : html(false), t('common.send', 'Send'), choice).then(function (ok) {
    return ok ? request({ commands: cmds(!!(choice && choice.checked)) }, t('device.queued', 'Queued: delivered after the next uplink')) : false;
  });
}

function retry(queued) {
  return ui.confirm(t('device.sendAgainTo', 'Send again to {device}?', { device: deviceName() }) + listOf(queued.commands) +
    t('device.deliveredNext', 'It is delivered after the device’s next uplink.'), t('common.send', 'Send')).then(function (ok) {
    return ok ? request({ commands: [] }, t('device.queuedAgain', 'Queued again: delivered after the next uplink')) : false;
  });
}

function discard(queued) {
  return ui.confirm(t('device.discardOn', 'Discard the queued changes on {device}?', { device: deviceName() }) + listOf(queued.commands) +
    t('device.discardNote', 'A frame the device has already received still applies.'), t('device.discard', 'Discard')).then(function (ok) {
    return ok ? request({ discard: true }, t('device.queueCleared', 'Queue cleared')) : false;
  });
}

/** Catalog measures of a position that the device neither subscribes nor reports, each
 * under the key the device reports it by: a group or index of 0 is left out (TRX_NANO.md §10). */
function unsubscribed(pos, node, own) {
  var p = node && state.peripherals[node.type];
  if (!p) { return []; }
  var have = {};
  own.forEach(function (s) { have[s.kind + '/' + s.group + '/' + s.index] = true; });
  return (p.measures || []).filter(function (m) {
    return !have[camel(m.kind) + '/' + (m.group || 0) + '/' + (m.index || 0)];
  }).map(function (m) {
    var key = 'p' + pos + '.' + camel(m.kind) + (m.group ? '.g' + m.group : '') + (m.index ? '.i' + m.index : '');
    var target = { mode: 'SOURCE', position: pos, kind: m.kind };
    if (m.group) { target.group = m.group; }
    if (m.index) { target.index = m.index; }
    return { sourceKey: key, measure: m, target: target };
  });
}

// -- stations (CA-1) -------------------------------------------------------------------------

function ownerOf() { return state.device.ownerId || {}; }

function mineOf(entries) { return M.mineOf(entries, state.device.id.id); }
function othersOf(entries) { return M.othersOf(entries, state.device.id.id); }

function relateToMap(stationId, entries) { return tb.relateToMap({ entityType: 'ASSET', id: stationId }, entries); }

function stationsToPick() {
  var owner = ownerOf();
  return owner.entityType === 'CUSTOMER' ? tb.io.fetchCustomerStations({ id: owner.id }) : tb.io.fetchAllStations();
}

/** Where a new station can go: the projects of the device's owner. */
function parentsToPick() {
  var owner = ownerOf().id;
  return tb.getAll('/api/user/assets', { type: 'Project' }).catch(function () { return []; }).then(function (list) {
    return list.filter(function (a) { return a.ownerId && a.ownerId.id === owner; }).map(function (a) {
      var level = tb.assetLevel(a);
      level.ownerId = owner;
      return level;
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  });
}

/** Pick a station, a new one included, or the channels of one already fed;
 * `preset` `{id, name}` picks a station on opening. */
function bindDrawer(binding, preset) {
  var dr = ui.openDrawer(binding ? t('device.channelsOf', 'Channels of {station}', { station: esc(binding.station.name) }) : t('device.connectTitle', 'Connect to a station'),
    t('device.fromDevice', 'from {device}', { device: esc(state.device.label || state.device.name) }));
  dr.el.classList.add('wide');
  var picked = binding ? binding.station : null;
  var pickedEntries = binding ? binding.entries : null;
  var stored = binding ? mineOf(binding.entries) : {};
  // A reading an earlier peripheral left is offered only where the station already stores it, to take it off.
  var rows = mappable().filter(function (r) { return !r.earlier || Object.keys(stored).some(function (c) { return stored[c] === r.key; }); });
  var body = dr.body;

  var stationField = h('<div class="ts-field"><div class="ts-field-label"><span>' + esc(t('common.station', 'Station')) + '</span></div><div class="ts-ctl"></div><div class="ts-field-hint" data-f="hint"></div></div>');
  var hint = stationField.querySelector('[data-f=hint]');
  var newFields = h('<div data-f="new" hidden><div class="ts-field"><div class="ts-field-label"><span>' + esc(t('device.newStationName', 'Name of the new station')) + '</span></div>' +
    '<div class="ts-ctl"><input class="ts-input wide" type="text" data-f="newName"></div></div>' +
    '<div class="ts-field"><div class="ts-field-label"><span>' + esc(t('device.newStationIn', 'In')) + '</span></div><div class="ts-ctl">' +
    '<select class="ts-select wide" data-f="parent"><option value="">' + esc(t('device.pickProject', 'Pick a project')) + '</option></select></div></div></div>');
  var parents = [];
  if (binding) {
    stationField.querySelector('.ts-ctl').appendChild(h('<b></b>')).textContent = binding.station.name;
  } else {
    var sel = h('<select class="ts-select wide" data-f="station"><option value="">' + esc(t('device.pickStation', 'Pick a station')) + '</option>' +
      '<option value="' + NEW_STATION + '">' + esc(t('device.newStation', 'New station…')) + '</option></select>');
    stationField.querySelector('.ts-ctl').appendChild(sel);
    stationsToPick().then(function (list) {
      var bound = {};
      state.bindings.forEach(function (b) { bound[b.station.id] = true; });
      list.filter(function (s) { return !bound[s.id]; }).sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (s) {
        var o = document.createElement('option'); o.value = s.id; o.textContent = s.name; o.dataset.name = s.name; sel.appendChild(o);
      });
      if (!preset) { return; }
      if (!sel.querySelector('option[value="' + preset.id + '"]')) { ui.toast(t('device.cannotTake', '{station} cannot take this device', { station: preset.name }), 'error'); return; }
      sel.value = preset.id;
      sel.dispatchEvent(new Event('change'));
    });
    parentsToPick().then(function (list) {
      parents = list;
      var psel = newFields.querySelector('[data-f=parent]');
      list.forEach(function (p) {
        var o = document.createElement('option'); o.value = p.id; o.textContent = p.name; psel.appendChild(o);
      });
    });
    sel.addEventListener('change', function () {
      var creating = sel.value === NEW_STATION;
      newFields.hidden = !creating;
      picked = sel.value && !creating ? { entityType: 'ASSET', id: sel.value, name: sel.selectedOptions[0].dataset.name, kind: 'Station' } : null;
      pickedEntries = null;
      hint.textContent = '';
      tick(null);
      if (!picked) { return; }
      tb.attrsMap(picked).then(function (a) {
        pickedEntries = resolver.mapEntries(a['config.channelMap']);
        var others = othersOf(pickedEntries);
        hint.textContent = others.length === 1
          ? t('device.othersFeedOne', 'Other devices feed 1 channel of this station ({list}); they stay theirs. A channel name picked here that one of them uses moves to this device, its history kept.', { list: others.join(', ') })
          : others.length
          ? t('device.othersFeedMany', 'Other devices feed {n} channels of this station ({list}); they stay theirs. A channel name picked here that one of them uses moves to this device, its history kept.', { n: others.length, list: others.join(', ') })
          : '';
        tick(pickedEntries);
      });
    });
  }
  body.appendChild(stationField);
  body.appendChild(newFields);

  var list = h('<div class="ts-field"><div class="ts-field-label"><span>' + esc(t('device.measurementsToStore', 'Measurements to store')) + ' ' + info('channelName') + '</span>' +
    '<span class="ts-spacer"></span><span class="ts-bind-count"></span></div><div class="ts-field-hint"></div><div class="ts-binds"></div></div>');
  list.querySelector('.ts-field-hint').textContent = t('device.tickMeasurements', 'Tick what the station stores. On the right, the channel each measurement is stored under.');
  var boxes = list.querySelector('.ts-binds');
  var countEl = list.querySelector('.ts-bind-count');
  var groups = [], byGroup = {};
  rows.forEach(function (r) {
    if (!byGroup[r.group]) { byGroup[r.group] = { id: r.group, label: r.groupLabel, rows: [] }; groups.push(byGroup[r.group]); }
    byGroup[r.group].rows.push(r);
  });
  groups.forEach(function (g) {
    var sec = boxes.appendChild(h('<details class="ts-bind-group"><summary><span class="ts-pos-chev">' + ICON.chev + '</span><span class="ts-bind-glabel"></span>' +
      '<span class="ts-count"></span><span class="ts-spacer"></span><button type="button" class="ts-btn ghost" data-a="all">' + esc(t('common.all', 'All')) + '</button>' +
      '<button type="button" class="ts-btn ghost" data-a="none">' + esc(t('device.noneButton', 'None')) + '</button></summary></details>'));
    sec.dataset.group = g.id;
    sec.querySelector('.ts-bind-glabel').textContent = g.label;
    sec.querySelector('summary').addEventListener('click', function (e) {
      var a = e.target.closest('[data-a]');
      if (!a) { return; }
      e.preventDefault();
      sec.querySelectorAll('input[data-key]').forEach(function (b) { b.checked = a.dataset.a === 'all'; });
      update();
    });
    g.rows.forEach(function (r) {
      var row = sec.appendChild(h('<div class="ts-bindrow"><label class="ts-bind-src"><input type="checkbox"><span class="ts-grow"><span class="ts-bind-name"></span>' +
        '<span class="ts-mono"></span></span><span class="ts-bind-val"></span></label><span class="ts-dev-arrow">→</span><div class="ts-bind-dst"></div></div>'));
      row.dataset.key = r.key;
      row.querySelector('input').dataset.key = r.key;
      row.querySelector('.ts-bind-name').textContent = r.label;
      row.querySelector('.ts-mono').textContent = r.key;
      var v = state.latest[r.key];
      var unit = family() === 'bus' ? unitOf(parseSource(r.key)) : readingUnit(r.key);
      row.querySelector('.ts-bind-val').textContent = v ? fmtValue(v.value) + (unit ? ' ' + unit : '') : '';
      var dst = row.querySelector('.ts-bind-dst');
      dst.appendChild(h('<select class="ts-select"></select>')).dataset.nameFor = r.key;
      dst.appendChild(h('<span class="ts-bind-key"></span>'));
    });
  });
  if (!rows.length) { boxes.appendChild(h('<div class="ts-empty"></div>')).textContent = t('device.nothingMeasured', 'Nothing measured by this device yet.'); }
  boxes.addEventListener('change', update);
  body.appendChild(list);

  function chosenRows() {
    return rows.filter(function (r) { return boxes.querySelector('input[data-key="' + r.key + '"]').checked; }).map(function (r) {
      return { key: r.key, name: boxes.querySelector('[data-name-for="' + r.key + '"]').value };
    });
  }

  /** Dim what is not stored, name the channel key each ticked row gets, count per group. */
  function update() {
    var chosen = chosenRows(), keys = {}, error = null;
    try {
      var channels = channelsFor(mineOf(pickedEntries), chosen);
      Object.keys(channels).forEach(function (c) { keys[channels[c]] = c; });
    } catch (e) { error = e.message; }
    rows.forEach(function (r) {
      var row = boxes.querySelector('.ts-bindrow[data-key="' + r.key + '"]');
      var on = row.querySelector('input').checked;
      row.classList.toggle('off', !on);
      var names = row.querySelector('select');
      if (names) { names.disabled = !on; }
      row.querySelector('.ts-bind-key').textContent = on ? (keys[r.key] ? t('device.storedAs', 'stored as {key}', { key: keys[r.key] }) : '') : t('common.notStored', 'not stored');
    });
    groups.forEach(function (g) {
      var n = g.rows.filter(function (r) { return boxes.querySelector('input[data-key="' + r.key + '"]').checked; }).length;
      boxes.querySelector('.ts-bind-group[data-group="' + g.id + '"] .ts-count').textContent = t('device.nOf', '{n} of {total}', { n: n, total: g.rows.length });
    });
    countEl.classList.toggle('ts-error', !!error);
    countEl.textContent = error || t('device.nOfStored', '{n} of {total} stored', { n: chosen.length, total: rows.length });
  }

  /** Tick what the station already takes from this device, else every
   * non-diagnostic measurement whose name is still free or repeats. */
  function tick(entries) {
    var mine = mineOf(entries);
    var mapped = Object.keys(mine).length > 0;
    var used = {};
    rows.forEach(function (r) {
      var box = boxes.querySelector('input[data-key="' + r.key + '"]');
      var channel = Object.keys(mine).filter(function (c) { return mine[c] === r.key; })[0];
      box.checked = mapped ? !!channel : !r.diagnostic && (!used[r.name] || !!(state.names[r.name] || {}).repeatable);
      if (box.checked) { used[r.name] = true; }
      fillNames(boxes.querySelector('[data-name-for="' + r.key + '"]'), r, entries, channel);
    });
    groups.forEach(function (g) {
      boxes.querySelector('.ts-bind-group[data-group="' + g.id + '"]').open =
        g.rows.some(function (r) { return !r.diagnostic || boxes.querySelector('input[data-key="' + r.key + '"]').checked; });
    });
    update();
  }
  tick(pickedEntries);

  ui.drawerActions(dr, t('common.save', 'Save')).addEventListener('click', function () {
    var chosen = chosenRows();
    if (!chosen.length) { ui.toast(t('device.pickMeasurement', 'Pick at least one measurement'), 'error'); return; }
    if (!binding && sel.value === NEW_STATION) {
      var name = newFields.querySelector('[data-f=newName]').value.trim();
      var parent = parents.filter(function (p) { return p.id === newFields.querySelector('[data-f=parent]').value; })[0];
      if (!name || !parent) { ui.toast(t('device.nameNewStation', 'Name the new station and pick where it goes'), 'error'); return; }
      save(null, {}, chosen, { name: name, parent: parent });
      return;
    }
    if (!picked) { ui.toast(t('device.pickStation', 'Pick a station'), 'error'); return; }
    save(picked, pickedEntries || {}, chosen, null);
  });
}

function channelLabel(key) { return M.channelLabel(state.names, key); }

function fillNames(select, r, entries, channel) {
  var o = M.nameOptions(model(), r, entries, channel, state.device.id.id);
  var options = o.options;
  select.innerHTML = '';
  options.forEach(function (n) {
    var opt = document.createElement('option'); opt.value = n; opt.textContent = channelLabel(n); select.appendChild(opt);
  });
  select.value = o.value;
}

function channelsFor(old, chosen) { return M.channelsFor(state.names, old, chosen); }

function save(station, entries, chosen, create) {
  var me = state.device.id.id, channels;
  try { channels = channelsFor(mineOf(entries), chosen); } catch (e) { ui.toast(e.message, 'error'); return; }
  var merged = M.withDevice(entries, me, channels), next = merged.next, takenOver = merged.takenOver;
  var n = chosen.length === 1 ? t('device.measurementOne', '1 measurement') : t('device.measurementMany', '{n} measurements', { n: chosen.length });
  var device = deviceName();
  var text = create
    ? t('device.confirmCreate', 'Create station {station} in {parent} and store {n} of {device} on it?',
        { station: '<b>' + esc(create.name) + '</b>', parent: '<b>' + esc(create.parent.name) + '</b>', n: n, device: device })
    : t('device.confirmStore', 'Store {n} of {device} on {station}?', { n: n, device: device, station: '<b>' + esc(station.name) + '</b>' }) + (takenOver.length
      ? t('device.takenOver', ' These channels move from another device to this one, their history kept: {list}.', { list: '<b>' + takenOver.map(esc).join(', ') + '</b>' }) : '');
  ui.confirm(text, t('common.save', 'Save')).then(function (ok) {
    if (!ok) { return; }
    var map = { 'config.channelMap': resolver.buildMap(next) };
    return (create ? tb.createStation(create.name, create.parent, map) : tb.saveAttrs(station, map).then(function () { return station; })).then(function (s) {
      station = s;
      return relateToMap(station.id, next);
    }).then(function () {
      return tb.resolveStations([station]);
    }).then(function () {
      ui.toast(create ? t('device.stationCreated', 'Station created, device connected') : t('common.saved', 'Saved'));
      ui.closeDrawer();
      return refresh();
    }).catch(function (err) { ui.toast(t('common.notSaved', 'Not saved: {error}', { error: errText(err) }), 'error'); });
  });
}

function disconnect(b) {
  ui.confirm(t('device.confirmDisconnect', 'Disconnect {device} from {station}? Its channels leave the station, which keeps their history.',
    { device: deviceName(), station: '<b>' + esc(b.station.name) + '</b>' }), t('device.disconnect', 'Disconnect')).then(function (ok) {
    if (!ok) { return; }
    var next = {};
    Object.keys(b.entries).forEach(function (c) { if (b.entries[c].device !== state.device.id.id) { next[c] = b.entries[c]; } });
    return tb.saveAttrs(b.station, { 'config.channelMap': resolver.buildMap(next) }).then(function () {
      return relateToMap(b.station.id, next);
    }).then(function () {
      return tb.resolveStations([b.station]);
    }).then(function () {
      ui.toast(t('device.disconnected', 'Disconnected'));
      return refresh();
    }).catch(function (err) { ui.toast(t('device.notDisconnected', 'Not disconnected: {error}', { error: errText(err) }), 'error'); });
  });
}

/** The measurements the stations can take, by key; filled on each render for a writer. */
var storable = {};

/** One measurement on every station the device feeds: whether each stores it and
 * under which channel, the *Channels* editor read across instead of down. Every
 * other channel of the station counts as taken, this device's own included, so a
 * second source of a repeatable name gets its next instance. */
function storeDrawer(r) {
  var me = state.device.id.id;
  var dr = ui.openDrawer(t('device.storeTitle', 'Store {label}', { label: esc(r.label) }), esc(state.device.label || state.device.name) + ' · ' + esc(r.key));
  dr.el.classList.add('wide');
  var list = dr.body.appendChild(h('<div class="ts-field"><div class="ts-field-label"><span>' + esc(t('common.stations', 'Stations')) + ' ' + info('channelName') + '</span></div>' +
    '<div class="ts-field-hint"></div><div class="ts-binds"></div></div>'));
  list.querySelector('.ts-field-hint').textContent = t('device.tickStations', 'Tick the stations that store this measurement. On the right, the channel it is stored under.');
  var boxes = list.querySelector('.ts-binds');
  var rows = state.bindings.map(function (b) {
    var mine = mineOf(b.entries);
    var from = Object.keys(mine).filter(function (c) { return mine[c] === r.key; })[0] || null;
    var rest = Object.assign({}, b.entries);
    if (from) { delete rest[from]; }
    var o = M.nameOptions(model(), r, rest, from, null);
    var row = boxes.appendChild(h('<div class="ts-bindrow"><label class="ts-bind-src"><input type="checkbox"><span class="ts-grow"><span class="ts-bind-name"></span>' +
      '<span class="ts-mono"></span></span></label><span class="ts-dev-arrow">→</span><div class="ts-bind-dst"><select class="ts-select"></select>' +
      '<span class="ts-bind-key"></span></div></div>'));
    row.dataset.station = b.station.name;
    row.querySelector('.ts-bind-name').textContent = b.station.name;
    row.querySelector('.ts-mono').textContent = b.writable ? '' : t('device.readOnlyForYou', 'read-only for you');
    var box = row.querySelector('input'), sel = row.querySelector('select');
    o.options.forEach(function (n) {
      var opt = sel.appendChild(document.createElement('option')); opt.value = n; opt.textContent = channelLabel(n) + ' (' + n + ')';
    });
    sel.value = o.value;
    box.checked = !!from;
    box.disabled = !b.writable;
    return { b: b, from: from, row: row, box: box, sel: sel };
  });
  if (!rows.length) { boxes.appendChild(h('<div class="ts-empty"></div>')).textContent = t('device.feedsNoStation', 'This device feeds no station yet.'); }
  var go = ui.drawerActions(dr, t('common.save', 'Save'));
  var connect = h('<button type="button" class="ts-btn ghost" data-a="connect-more">' + ICON.plus + esc(t('device.connectOrCreate', 'Connect or create a station')) + '</button>');
  dr.foot.insertBefore(connect, dr.foot.firstChild);
  connect.addEventListener('click', function () { bindDrawer(null); });

  /** What the row changes: null for nothing, else `{next, note}` or `{error}`. */
  function plan(x) {
    var target = x.box.checked ? x.sel.value : null;
    if (target === x.from) { return null; }
    var p = M.storeOne(x.b.entries, me, r.key, x.from, target);
    if (p.own) {
      return { error: t('device.channelTaken', '{label} ({channel}) already stores another measurement of this device: change that one first.', { label: channelLabel(target), channel: target }) };
    }
    var note = !target ? t('device.leavesStation', 'leaves the station, which keeps its history')
      : x.from ? t('device.storedAsFrom', 'stored as {key}; the readings so far stay under {from}', { key: target, from: x.from }) : t('device.storedAs', 'stored as {key}', { key: target });
    if (p.takenOver) {
      note += p.takenOver.device ? t('device.takenFromDevice', '; {channel} moves from another device to this measurement, its history kept', { channel: target })
        : t('device.takenFromNone', '; {channel} moves from no device to this measurement, its history kept', { channel: target });
    }
    return { next: p.next, note: note };
  }
  function update() {
    var error = false;
    rows.forEach(function (x) {
      var p = plan(x);
      x.row.classList.toggle('off', !x.box.checked);
      x.sel.disabled = !x.box.checked || !x.b.writable;
      var key = x.row.querySelector('.ts-bind-key');
      key.classList.toggle('ts-error', !!(p && p.error));
      key.textContent = p ? p.error || p.note : x.from ? t('device.storedAs', 'stored as {key}', { key: x.from }) : t('common.notStored', 'not stored');
      error = error || !!(p && p.error);
    });
    go.disabled = error;
  }
  boxes.addEventListener('change', update);
  update();

  go.addEventListener('click', function () {
    var changes = rows.map(function (x) { return { x: x, p: plan(x) }; }).filter(function (c) { return c.p; });
    if (!changes.length) { ui.closeDrawer(); return; }
    ui.confirm(t('device.storeConfirm', '{label} of {device}:', { label: '<b>' + esc(r.label) + '</b>', device: deviceName() }) + '<ul>' + changes.map(function (c) {
      return '<li>' + esc(c.x.b.station.name) + ': ' + esc(c.p.note) + '</li>';
    }).join('') + '</ul>', t('common.save', 'Save')).then(function (ok) {
      if (!ok) { return; }
      return Promise.all(changes.map(function (c) {
        return tb.saveAttrs(c.x.b.station, { 'config.channelMap': resolver.buildMap(c.p.next) }).then(function () {
          return relateToMap(c.x.b.station.id, c.p.next);
        });
      })).then(function () {
        return tb.resolveStations(changes.map(function (c) { return c.x.b.station; }));
      }).then(function () {
        ui.toast(t('common.saved', 'Saved'));
        ui.closeDrawer();
        return refresh();
      }).catch(function (err) { ui.toast(t('common.notSaved', 'Not saved: {error}', { error: errText(err) }), 'error'); });
    });
  });
}

/** Every stored key of a LOGR2 sensor, its bookkeeping and the dry contact interface's
 * rule matches included. */
function sensorKeys(part) {
  return Object.keys(state.latest).filter(function (k) {
    return k.indexOf(part.id + '.') === 0 || (part.id === 'dryc' && RULE_SOURCE.test(k));
  });
}

/** A LOGR2 sensor no longer used, or an earlier peripheral's readings: delete them on the
 * device, and take their channels off the stations the user may write. Station history stays. */
function deleteData(label, keys) {
  var fed = [];
  state.bindings.forEach(function (b) {
    var channels = mineOf(b.entries);
    var gone = Object.keys(channels).filter(function (c) { return keys.indexOf(channels[c]) >= 0; });
    if (gone.length && b.writable) { fed.push({ binding: b, gone: gone }); }
  });
  var text = t('device.confirmDeleteData', 'Delete the data of the {part} on {device}? Its {n} measurements and their history on the device are deleted.',
      { part: '<b>' + esc(label) + '</b>', device: deviceName(), n: keys.length }) +
    (fed.length ? t('device.deleteDataChannels', ' These station channels stop receiving values and keep their history:') + ' <ul>' + fed.map(function (f) {
      return '<li>' + esc(f.binding.station.name) + ' · ' + f.gone.map(esc).join(', ') + '</li>';
    }).join('') + '</ul>' : '') +
    t('device.deleteDataReturns', ' A sensor that still reports comes back with its next reading.');
  ui.confirm(text, t('common.delete', 'Delete')).then(function (ok) {
    if (!ok) { return; }
    return tb.del('/api/plugins/telemetry/DEVICE/' + state.device.id.id + '/timeseries/delete',
      { keys: keys.join(','), deleteAllDataForKeys: 'true', rewriteLatestIfDeleted: 'false' }).then(function () {
      return Promise.all(fed.map(function (f) {
        var next = Object.assign({}, f.binding.entries);
        f.gone.forEach(function (c) { delete next[c]; });
        return tb.saveAttrs(f.binding.station, { 'config.channelMap': resolver.buildMap(next) });
      }));
    }).then(function () {
      return fed.length ? tb.resolveStations(fed.map(function (f) { return f.binding.station; })) : null;
    }).then(function () {
      ui.toast(t('device.dataDeleted', '{part} data deleted', { part: label }));
      return refresh();
    }).catch(function (err) { ui.toast(t('common.notDeleted', 'Not deleted: {error}', { error: errText(err) }), 'error'); });
  });
}

// -- replace device (DEVICE_VIEW.md §2, CA-13) -------------------------------------------------

var PROVENANCE_KEY = /^(uplinkTriggered|uplinkCause|uplinkLatest|rssi|snr)$|\.status$/;

/** The stations whose channels this device feeds and the user may write. */
function replaceable() {
  return state.bindings.filter(function (b) { return b.writable && Object.keys(mineOf(b.entries)).length; });
}

/** Every key this device reports or feeds a station with. */
function ownKeys() {
  var keys = {};
  Object.keys(state.latest).forEach(function (k) { keys[k] = true; });
  state.bindings.forEach(function (b) {
    var mine = mineOf(b.entries);
    Object.keys(mine).forEach(function (c) { keys[mine[c]] = true; });
  });
  return Object.keys(keys);
}

/** What can go over to the replacement, each `{id, text, keys}`: its label, its
 * register, its own limits and retention. The inactivity timeout follows the
 * register's interval, as the register's own save writes it. */
function carryRows() {
  var s = state.server, rows = [];
  if (state.device.label) { rows.push({ id: 'label', text: t('device.carryLabel', 'Label: {label}', { label: state.device.label }), keys: [] }); }
  var reg = Object.keys(s).filter(function (k) { return /^register\./.test(k); }).sort();
  if (reg.length) {
    rows.push({ id: 'register', text: t('device.carryRegister', 'Register: {list}', { list: reg.map(function (k) { return k.slice('register.'.length); }).join(', ') }),
                keys: reg.concat(s['register.intervalSeconds'] !== undefined && s.inactivityTimeout !== undefined ? ['inactivityTimeout'] : []) });
  }
  var limits = Object.keys(s).filter(function (k) { return /^channel\./.test(k) || k === 'config.ttlDays'; }).sort();
  if (limits.length) {
    rows.push({ id: 'limits', text: limits.length === 1 ? t('device.carryLimitsOne', 'Own limits and retention: 1 setting')
      : t('device.carryLimitsMany', 'Own limits and retention: {n} settings', { n: limits.length }), keys: limits });
  }
  return rows;
}

/** Replace this device by another of the same owner, in one save: each channel
 * it feeds moves to a source key of the replacement — the same key when it has
 * it, else one of the same kind — and a channel left unmatched leaves its
 * station, which keeps its history. This device keeps its own. */
function replaceDrawer() {
  var me = state.device.id.id, owner = ownerOf(), bound = replaceable(), candidates = {};
  var dr = ui.openDrawer(t('device.replaceTitle', 'Replace device'), esc(state.device.label || state.device.name));
  dr.el.classList.add('wide');
  var field = dr.body.appendChild(h('<div class="ts-field"><div class="ts-field-label"><span>' + esc(t('device.replacement', 'Replacement')) + '</span></div>' +
    '<div class="ts-ctl"><select class="ts-select wide" data-f="device"><option value="">' + esc(t('device.pickDevice', 'Pick a device')) + '</option></select></div>' +
    '<div class="ts-field-hint"></div></div>'));
  field.querySelector('.ts-field-hint').textContent = bound.length
    ? t('device.replaceHintFed', 'Every channel this device feeds moves to the replacement; each station keeps its history, this device keeps its own.')
    : t('device.replaceHintFree', 'This device feeds no station: the replacement takes over what is ticked below.');
  var sel = field.querySelector('select');
  var table = dr.body.appendChild(h('<div class="ts-binds" data-f="match"></div>'));
  var unmatched = dr.body.appendChild(h('<div class="ts-field-hint" data-f="unmatched"></div>'));
  var rows = carryRows();
  if (rows.length) {
    var carry = dr.body.appendChild(h('<div class="ts-field"><div class="ts-field-label"><span>' + esc(t('device.carryOver', 'Carry over')) + '</span></div><div class="ts-carry"></div></div>'));
    rows.forEach(function (r) {
      var row = carry.querySelector('.ts-carry').appendChild(h('<label class="ts-switch"><input type="checkbox" checked> <span></span></label>'));
      row.querySelector('input').setAttribute('data-carry', r.id);
      row.querySelector('span').textContent = r.text;
    });
  }

  // The owner's devices, the free ones first, then each under the stations it feeds.
  var url = owner.entityType === 'CUSTOMER' ? '/api/customer/' + owner.id + '/devices' : '/api/tenant/devices';
  tb.getAll(url, {}).then(function (list) {
    return Promise.all(list.filter(function (d) { return d.id.id !== me && d.ownerId.id === owner.id; }).map(function (d) {
      return tb.deviceParents({ id: d.id.id }).then(function (parents) {
        d.feeds = parents.map(function (p) { return p.name; }).sort().join(', ');
        return d;
      });
    }));
  }).then(function (list) {
    var groups = {};
    list.sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (d) {
      candidates[d.id.id] = d;
      (groups[d.feeds] = groups[d.feeds] || []).push(d);
    });
    Object.keys(groups).sort(function (a, b) { return !!a - !!b || a.localeCompare(b); }).forEach(function (feeds) {
      var group = sel.appendChild(document.createElement('optgroup'));
      group.label = feeds ? t('common.feeding', 'Feeding {stations}', { stations: feeds }) : t('common.free', 'Free');
      groups[feeds].forEach(function (d) {
        var o = group.appendChild(document.createElement('option'));
        o.value = d.id.id;
        o.textContent = d.name + (d.label ? ' · ' + d.label : '') + ' (' + d.type + ')';
      });
    });
  });

  function showUnmatched() {
    var left = Array.prototype.filter.call(table.querySelectorAll('select[data-station]'), function (p) { return !p.value; });
    unmatched.textContent = left.length ? t('device.unmatched', 'Unmatched, leaving their station: {list}', { list: left.map(function (p) { return p.dataset.channel; }).join(', ') }) : '';
  }
  table.addEventListener('change', showUnmatched);

  sel.addEventListener('change', function () {
    table.innerHTML = '';
    unmatched.textContent = '';
    var d = candidates[sel.value];
    if (!d) { return; }
    Promise.all([
      tb.get('/api/plugins/telemetry/DEVICE/' + d.id.id + '/keys/timeseries').catch(function () { return []; }),
      tb.attrsMap({ entityType: 'DEVICE', id: d.id.id }, 'CLIENT_SCOPE')
    ]).then(function (got) {
      var how = {}, reported = tb.readingKeys(got[0]);
      reported.forEach(function (k) { how[k] = 'reports'; });
      Object.keys(got[1] || {}).forEach(function (a) {
        var m = /^subscriptions\.(.+)\.(?:enabled|interval)$/.exec(a);
        if (m && !how[m[1]]) { how[m[1]] = 'subscribes'; }
      });
      // A replacement of the same family not heard from yet will report what this one reports.
      if (d.type === state.device.type && !reported.length) {
        ownKeys().forEach(function (k) { if (!how[k]) { how[k] = 'expected'; } });
      }
      var offered = Object.keys(how).filter(function (k) { return !PROVENANCE_KEY.test(k) && NOT_READINGS.indexOf(k) < 0; }).sort();
      bound.forEach(function (b) {
        var mine = mineOf(b.entries);
        var grp = table.appendChild(h('<div class="ts-bind-group" open><div class="ts-section-head"></div></div>'));
        grp.firstChild.textContent = b.station.name;
        Object.keys(mine).sort().forEach(function (c) {
          var key = mine[c], kind = resolver.deviceKeyKind(key, state.names);
          var same = offered.filter(function (k) { return resolver.deviceKeyKind(k, state.names) === kind; });
          var guess = offered.indexOf(key) >= 0 ? key : same.length === 1 ? same[0] : '';
          var row = grp.appendChild(h('<div class="ts-bindrow"><span class="ts-grow"><span class="ts-bind-name"></span><span class="ts-mono"></span></span>' +
            '<span class="ts-dev-arrow">→</span><select class="ts-select"></select></div>'));
          row.querySelector('.ts-bind-name').textContent = c;
          row.querySelector('.ts-mono').textContent = key;
          var pick = row.querySelector('select');
          pick.dataset.station = b.station.id;
          pick.dataset.channel = c;
          pick.appendChild(h('<option value=""></option>')).textContent = t('device.leavesStationShort', 'leaves the station');
          (same.length ? same : offered).forEach(function (k) {
            var o = pick.appendChild(document.createElement('option'));
            o.value = k;
            o.textContent = k + (how[k] === 'expected' ? ' (' + t('device.expected', 'expected') + ')' : '');
          });
          pick.value = guess;
        });
      });
      showUnmatched();
    }).catch(function (err) { ui.toast(t('device.replacementUnreadable', 'Could not read the replacement: {error}', { error: errText(err) }), 'error'); });
  });

  ui.drawerActions(dr, t('device.replace', 'Replace')).addEventListener('click', function () {
    var d = candidates[sel.value];
    if (!d) { ui.toast(t('device.pickReplacement', 'Pick the replacement'), 'error'); return; }
    var target = { entityType: 'DEVICE', id: d.id.id, name: d.name, label: d.label, kind: d.type };
    var picks = Array.prototype.slice.call(table.querySelectorAll('select[data-station]'));
    var dropped = picks.filter(function (p) { return !p.value; }).map(function (p) { return p.dataset.channel; });
    var carried = rows.filter(function (r) { return dr.body.querySelector('[data-carry=' + r.id + ']').checked; });
    ui.confirm((bound.length ? (picks.length - dropped.length === 1 ? t('device.confirmMoveToOne', 'Move 1 channel to {device}?', { device: '<b>' + esc(d.name) + '</b>' })
      : t('device.confirmMoveToMany', 'Move {n} channels to {device}?', { n: picks.length - dropped.length, device: '<b>' + esc(d.name) + '</b>' }))
      : t('device.confirmReplaceBy', 'Replace by {device}?', { device: '<b>' + esc(d.name) + '</b>' })) +
      (dropped.length ? t('device.droppedChannels', ' These leave their station, which keeps their history: {list}.', { list: '<b>' + dropped.map(esc).join(', ') + '</b>' }) : '') +
      (carried.length ? t('device.takesOver', ' It takes over: {list}.', { list: carried.map(function (r) { return esc(r.text); }).join('; ') }) : ''), t('device.replace', 'Replace'))
      .then(function (ok) {
        if (!ok) { return; }
        var moved = [];
        return Promise.all(bound.map(function (b) {
          var next = {}, keys = [];
          Object.keys(b.entries).forEach(function (c) {
            if (b.entries[c].device !== me) { next[c] = b.entries[c]; return; }
            var p = picks.filter(function (x) { return x.dataset.station === b.station.id && x.dataset.channel === c; })[0];
            if (p && p.value) { next[c] = { device: target.id, key: p.value }; keys.push(b.entries[c].key); }
          });
          moved.push({ station: b.station, attrs: b.attrs, channels: Object.keys(next).filter(function (c) { return next[c].device === target.id; }), keys: keys });
          return tb.saveAttrs(b.station, { 'config.channelMap': resolver.buildMap(next) }).then(function () {
            return relateToMap(b.station.id, next);
          });
        })).then(function () {
          var write = {};
          carried.forEach(function (r) { r.keys.forEach(function (k) { write[k] = state.server[k]; }); });
          return tb.saveAttrs(target, write).then(function () {
            return carried.some(function (r) { return r.id === 'label'; }) ? tb.setLabel(target, state.device.label) : null;
          });
        }).then(function () {
          return tb.resolveStations(bound.map(function (b) { return b.station; }).concat([target]));
        }).then(function () {
          state.followUp = { target: target, steps: followUpSteps(target, moved) };
          ui.toast(t('device.replaced', 'Device replaced'));
          ui.closeDrawer();
          return refresh();
        });
      }).catch(function (err) { ui.toast(t('device.notReplaced', 'Not replaced: {error}', { error: errText(err) }), 'error'); });
  });
}

/** The `calc.*` zero references of a station's calculated channels that read a channel now fed by the replacement. */
function zeroReferences(m) {
  var fed = m.channels.map(function (c) { return resolver.splitChannelKey(c).name; }), out = [];
  resolver.calculationPlan(m.attrs, state.names).filter(function (p) { return p.on; }).forEach(function (p) {
    p.reads.forEach(function (a) {
      var spec = state.calcAttributes[a];
      if (spec && spec.reading && fed.indexOf(spec.reading) >= 0 && out.indexOf(a) < 0) { out.push(a); }
    });
  });
  return out;
}

/** What a replacement leaves to do, each step applying only where it has something to do. */
function followUpSteps(target, moved) {
  var steps = [];
  var dryc = moved.some(function (m) {
    var rules = parseJson(m.attrs['dryc.rules']);
    return rules && (rules.rules || []).length && m.keys.some(function (k) { return DRYC_KEY.test(k); });
  });
  var drycStation = moved.filter(function (m) { return parseJson(m.attrs['dryc.rules']); })[0];
  if (dryc && drycStation && opts.projectDashboardId) {
    var send = { a: 'dryc', label: t('device.stepDryc', 'Send the DRYC rules of {station} to {device}', { station: drycStation.station.name, device: target.name }),
                 action: t('device.stepSend', 'Send…') };
    send.run = function () {
      send.done = true;
      tb.openDashboard(opts.projectDashboardId, 'dryc', drycStation.station);
    };
    steps.push(send);
  }
  moved.forEach(function (m) {
    var refs = zeroReferences(m);
    if (!refs.length) { return; }
    var step = { a: 'zero', label: t('device.stepZero', 'Set the zero reference on {station}', { station: m.station.name }), action: t('device.stepSet', 'Set…') };
    step.run = function () { zeroDrawer(step, m.station, refs); };
    steps.push(step);
  });
  steps.push({ a: 'out-of-service', label: t('device.stepOutOfService', 'Mark {device} out of service', { device: state.device.label || state.device.name }),
    action: t('lifecycle.service.outMenu', 'Out of service…'),
    run: function () { life.outOfService(deviceEntity(), refresh); } });
  return steps;
}

/** The station's zero references, taken again from the replacement's readings. */
function zeroDrawer(step, station, refs) {
  var dr = ui.openDrawer(t('device.zeroTitle', 'Set the zero reference'), esc(station.name));
  dr.body.appendChild(h('<div class="ts-field-hint"></div>')).textContent = t('device.zeroHint', 'The replacement reads its own zero: take its reading as the reference, or keep the value.');
  tb.attrsMap(station).then(function (attrs) {
    var form = calc.form(station, attrs, refs, { names: state.names, attributes: state.calcAttributes });
    dr.body.appendChild(form.el);
    ui.drawerActions(dr, t('common.save', 'Save')).addEventListener('click', function () {
      var write = form.values();
      if (!write) { ui.toast(t('device.zeroInvalid', 'Enter a number for each reference'), 'error'); return; }
      calc.save(station, write).then(function () {
        step.done = true;
        ui.closeDrawer();
        ui.toast(t('device.zeroSaved', 'Zero reference saved'));
        render();
      }).catch(function (err) { ui.toast(t('common.notSaved', 'Not saved: {error}', { error: errText(err) }), 'error'); });
    });
  });
}

/** The follow-up card of the last replacement, until every step is done or it is dismissed. */
function followUpCard() {
  var f = state.followUp;
  if (!f) { return null; }
  f.steps.forEach(function (s) { if (s.a === 'out-of-service') { s.done = !!tb.serviceOf(state.server).state; } });
  if (f.steps.every(function (s) { return s.done; })) { state.followUp = null; return null; }
  var card = ui.followUp(t('device.followUp', 'Replaced by {device}: next steps', { device: f.target.name }), f.steps, function () { state.followUp = null; });
  card.setAttribute('data-followup', f.target.name);
  return card;
}

// -- bus moves (CA-14) --------------------------------------------------------------------------

/** Positions whose wired sources went silent while another position, feeding
 * no station, reports the same peripheral type — by its topology type when
 * both are listed, else by the kinds it measures: `[{from, to, since}]`. */
function sourceTs(s) { return (state.latest[s.sourceKey] || {}).ts || 0; }
function newestTs(list) { return Math.max.apply(null, list.map(sourceTs)); }
/** No reading for three of its intervals (mapping.js). */
function silentSource(s) { return M.silent(model(), s); }

function busMoves(nodes, srcs) {
  var byPos = {}, moves = [];
  srcs.forEach(function (s) { if (s.position) { (byPos[s.position] = byPos[s.position] || []).push(s); } });
  Object.keys(byPos).forEach(function (p) {
    var wired = byPos[p].filter(function (s) { return state.wiring[s.sourceKey]; });
    if (!wired.length || !newestTs(wired) || !wired.every(silentSource)) { return; }
    var kinds = wired.map(function (s) { return s.kind; });
    var to = Object.keys(byPos).filter(function (q) {
      var own = byPos[q];
      if (q === p || own.some(function (s) { return state.wiring[s.sourceKey]; }) || newestTs(own) <= newestTs(wired) || own.every(silentSource)) { return false; }
      return nodes[p] && nodes[q] ? nodes[p].type === nodes[q].type
        : kinds.every(function (k) { return own.some(function (s) { return s.kind === k; }); });
    })[0];
    if (to) { moves.push({ from: Number(p), to: Number(to), since: newestTs(wired) }); }
  });
  return moves;
}

function moveBanner(move) {
  var el = h('<div class="ts-banner warn" data-banner="move">' + ICON.info + '<span class="ts-grow"></span></div>');
  el.querySelector('span').textContent = t('device.moveBanner', 'Position {from} silent since {since}, position {to} reports the same type',
    { from: move.from, since: ui.when(move.since), to: move.to });
  if (state.writable) {
    el.appendChild(h('<button type="button" class="ts-btn" data-a="move-channels">' + esc(t('device.moveChannels', 'Move channels')) + '</button>'))
      .addEventListener('click', function () { moveChannels(move); });
  }
  return el;
}

/** Rewrite this device's map entries from one position to the other; each channel keeps its history. */
function moveChannels(move) {
  var me = state.device.id.id, from = new RegExp('^p' + move.from + '\\.'), to = 'p' + move.to + '.';
  function moving(e) { return e.device === me && from.test(e.key); }
  var touched = state.bindings.filter(function (b) {
    return b.writable && Object.keys(b.entries).some(function (c) { return moving(b.entries[c]); });
  });
  var items = [];
  touched.forEach(function (b) {
    Object.keys(b.entries).filter(function (c) { return moving(b.entries[c]); }).forEach(function (c) {
      items.push('<li>' + esc(b.station.name) + ' · ' + esc(c) + ': ' + esc(b.entries[c].key) + ' → ' + esc(b.entries[c].key.replace(from, to)) + '</li>');
    });
  });
  ui.confirm(t('device.confirmMove', 'Move these channels from position {from} to position {to}? Each keeps its history.', { from: move.from, to: move.to }) +
    '<ul>' + items.join('') + '</ul>', t('common.move', 'Move'))
    .then(function (ok) {
      if (!ok) { return; }
      return Promise.all(touched.map(function (b) {
        var next = {};
        Object.keys(b.entries).forEach(function (c) {
          var e = b.entries[c];
          next[c] = moving(e) ? { device: e.device, key: e.key.replace(from, to) } : e;
        });
        return tb.saveAttrs(b.station, { 'config.channelMap': resolver.buildMap(next) });
      })).then(function () {
        return tb.resolveStations(touched.map(function (b) { return b.station; }));
      }).then(function () {
        ui.toast(t('device.moved', 'Channels moved to position {to}', { to: move.to }));
        return refresh();
      });
    }).catch(function (err) { ui.toast(t('common.notMoved', 'Not moved: {error}', { error: errText(err) }), 'error'); });
}

// -- register -------------------------------------------------------------------------------

/** Hand-kept facts a device cannot report (ATTRIBUTES.md §3): the four
 * `register.*` fields of a LOGR2, and the measurement interval of any device
 * other than a LOGR3 or LOGR4, from which its inactivity timeout follows:
 * three intervals, as a LOGR3 or LOGR4 derives its own. */
function registerFields() { return family() === 'logr2' ? register() : []; }

/** The register's values in reading order, each `{key, label, value, warn}`; exceptions first. */
function registerRows() {
  var s = state.server, rows = [];
  registerFields().forEach(function (f) {
    var v = s[f.key];
    if (v === undefined || v === '') { return; }
    if (f.flag) { rows.push({ key: f.key, label: f.label, value: truthyFlag(v) ? t('device.possible', 'possible') : t('device.impossible', 'impossible'), warn: !truthyFlag(v) }); }
    else { rows.push({ key: f.key, label: f.label, value: String(v), warn: f.key === 'register.hwStatus' && !FINE_STATUS.test(String(v)) }); }
  });
  var interval = Number(s['register.intervalSeconds']);
  rows.push({ key: 'register.intervalSeconds', label: t('device.measurementInterval', 'Measurement interval'),
              value: interval > 0 ? fmtDuration(interval) : t('device.notSet', 'not set'), warn: !(interval > 0) });
  var timeout = Number(s.inactivityTimeout);
  rows.push({ key: 'inactivityTimeout', label: t('device.inactivityTimeout', 'Inactivity timeout'),
              value: timeout > 0 ? fmtDuration(timeout / 1000) : t('device.platformDefault', 'platform default'), warn: false });
  return rows.filter(function (r) { return r.warn; }).concat(rows.filter(function (r) { return !r.warn; }));
}

function registerCard() {
  var card = railCard('register', t('device.register', 'Register'), 'register');
  card.head.appendChild(h('<span class="ts-dev-card-note"></span>')).textContent = t('device.keptByHand', 'kept by hand');
  if (state.writable) {
    card.head.appendChild(h('<button type="button" class="ts-btn sm" data-a="register">' + ICON.edit + esc(t('common.edit', 'Edit')) + '</button>'))
      .addEventListener('click', registerDrawer);
  }
  var dl = card.body.appendChild(h('<dl class="ts-dev-dl"></dl>'));
  registerRows().forEach(function (r) {
    var row = dl.appendChild(h('<div class="ts-reg' + (r.warn ? ' warn' : '') + '"><dt></dt><dd><span class="ts-reg-value"></span></dd></div>'));
    row.setAttribute('data-register', r.key);
    row.querySelector('dt').textContent = r.label;
    row.querySelector('.ts-reg-value').textContent = r.value;
  });
  return card.el;
}

function registerDrawer() {
  var s = state.server;
  var dr = ui.openDrawer(t('device.register', 'Register'), esc(state.device.name));
  registerFields().forEach(function (f) {
    var field = h('<div class="ts-field"><div class="ts-field-label"><span></span></div><div class="ts-ctl"></div></div>');
    field.querySelector('span').textContent = f.label;
    var input = f.flag
      ? h('<label><input type="checkbox"> ' + esc(t('device.possibleOnUnit', 'possible on this unit')) + '</label>')
      : h('<input class="ts-input" type="text">');
    var el = f.flag ? input.querySelector('input') : input;
    el.setAttribute('data-key', f.key);
    if (f.flag) { el.checked = truthyFlag(s[f.key]); } else { el.value = s[f.key] === undefined ? '' : s[f.key]; }
    field.querySelector('.ts-ctl').appendChild(input);
    dr.body.appendChild(field);
  });
  dr.body.appendChild(h('<div class="ts-field"><div class="ts-field-label"><span>' + esc(t('device.measurementInterval', 'Measurement interval')) + '</span></div>' +
    '<div class="ts-ctl"><span><input class="ts-input num" type="number" min="0" step="1" data-key="register.intervalSeconds"> min</span></div>' +
    '<div class="ts-field-hint">' + esc(t('device.intervalHint', 'How often the device measures and sends. A channel older than three intervals is stale, and the device turns inactive after three intervals without an uplink.')) +
    '</div></div>'));
  var minutes = dr.body.querySelector('[data-key="register.intervalSeconds"]');
  minutes.value = Number(s['register.intervalSeconds']) > 0 ? Number(s['register.intervalSeconds']) / 60 : '';
  ui.drawerActions(dr, t('common.save', 'Save')).addEventListener('click', function () {
    var write = {}, drop = [];
    dr.body.querySelectorAll('[data-key]').forEach(function (el) {
      var key = el.getAttribute('data-key');
      if (key === 'register.intervalSeconds') {
        if (el.value === '') {
          if (s[key] !== undefined) { drop.push(key); }
          if (s.inactivityTimeout !== undefined) { drop.push('inactivityTimeout'); }
        } else {
          write[key] = Math.round(Number(el.value) * 60);
          write.inactivityTimeout = 3 * write[key] * 1000;
        }
      } else if (el.type === 'checkbox') {
        write[key] = el.checked;
      } else if (el.value.trim()) {
        write[key] = el.value.trim();
      } else if (s[key] !== undefined) {
        drop.push(key);
      }
    });
    if (write['register.intervalSeconds'] !== undefined && !(write['register.intervalSeconds'] > 0)) { ui.toast(t('device.intervalMinutesInvalid', 'An interval is a positive number of minutes'), 'error'); return; }
    var dev = deviceEntity();
    tb.saveAttrs(dev, write).then(function () { return tb.deleteAttrs(dev, drop); }).then(function () {
      ui.toast(t('device.attributesSaved', 'Attributes saved'));
      ui.closeDrawer();
      return refresh();
    }).catch(function (err) { ui.toast(t('common.notSaved', 'Not saved: {error}', { error: errText(err) }), 'error'); });
  });
}

// -- skeleton ---------------------------------------------------------------------------

root.innerHTML = '';
var cardEl = h('<div class="ts-card ts-readonly ts-dev"><div class="ts-head"><div class="ts-dev-figure"></div><div class="ts-head-text">' +
  '<div class="ts-title"><span class="ts-dev-name"></span><span class="ts-dev-live"></span></div><div class="ts-subtitle"></div></div><span class="ts-dev-chips"></span>' +
  '<div class="ts-dev-acts"></div></div>' +
  '<div class="ts-body"><div class="ts-loading">' + esc(t('common.loading', 'Loading…')) + '</div></div>' +
  '<div class="ts-foot"><span class="ts-summary"></span><span class="ts-spacer"></span><button type="button" class="ts-btn">' + ICON.reset + esc(t('common.refresh', 'Refresh')) + '</button></div></div>');
root.appendChild(cardEl);
var nav = window.TerrySenseNav(ctx, tb, ui, cardEl, opts);
var bodyEl = cardEl.querySelector('.ts-body');
var summaryEl = cardEl.querySelector('.ts-summary');
var refreshBtn = cardEl.querySelector('.ts-foot .ts-btn');
var chipsEl = cardEl.querySelector('.ts-dev-chips');
var actsEl = cardEl.querySelector('.ts-dev-acts');

// Below 720 px, a phone or a narrow dashboard cell: one column, the measurements as a list.
new ResizeObserver(function () { cardEl.classList.toggle('narrow', cardEl.clientWidth < 720); }).observe(cardEl);

function fail(text) {
  bodyEl.innerHTML = '';
  bodyEl.appendChild(h('<div class="ts-empty"></div>')).textContent = text;
}

// -- render -----------------------------------------------------------------------------

/** Health first, then the measurements beside the rail: stations, then the device-wide Configure or the register. */
function render() {
  nav.follow(state.bindings.map(function (b) { return b.station.id; }));
  renderHead();
  var scroll = bodyEl.scrollTop;
  bodyEl.innerHTML = '';
  storable = {};
  if (state.writable) { mappable().forEach(function (r) { storable[r.key] = r; }); }
  renderService();
  var follow = followUpCard();
  if (follow) { bodyEl.appendChild(follow); }
  var jump = bodyEl.appendChild(h('<nav class="ts-dev-jump"></nav>'));
  var layout = bodyEl.appendChild(h('<div class="ts-dev-layout"><div class="ts-dev-main"></div><div class="ts-dev-rail"></div></div>'));
  layout.firstChild.appendChild(measurementsSection());
  // The status counts the measurement rows, so it is built after them.
  bodyEl.insertBefore(healthStrip(), jump);
  var rail = layout.lastChild;
  rail.appendChild(stationsCard());
  if (family() === 'bus') {
    var cmds = commandsCard();
    if (cmds) { rail.appendChild(cmds); }
  } else {
    rail.appendChild(registerCard());
  }
  bodyEl.querySelectorAll('[data-section]').forEach(function (sec) {
    var title = sec.getAttribute('data-title');
    if (!title) { return; }
    var b = jump.appendChild(h('<button type="button" class="ts-dev-jump-btn"></button>'));
    b.dataset.jump = sec.getAttribute('data-section');
    b.textContent = title;
    b.addEventListener('click', function () { sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  });
  bodyEl.scrollTop = scroll;
  cardEl.classList.toggle('ts-readonly', !state.writable);
  summaryEl.textContent = t('common.readAt', 'Read {time}', { time: new Date(state.loadedAt).toLocaleTimeString(t.locale()) });
}

/** Who the device is: its label, live or not, the ID, versions and an available update. */
function renderHead() {
  var d = state.device, type = String(d.type || '');
  var active = truthyFlag(state.server.active);
  cardEl.querySelector('.ts-dev-name').textContent = d.label || d.name;
  var live = cardEl.querySelector('.ts-dev-live');
  live.className = 'ts-dev-live ts-chip ' + (active ? 'ok' : 'fault');
  live.dataset.live = String(active);
  live.textContent = active ? t('fleet.live', 'Live') : t('fleet.inactive', 'Inactive');
  var figure = cardEl.querySelector('.ts-dev-figure'), image = ui.productImage(type);
  figure.dataset.type = type;
  figure.dataset.figure = image ? 'image' : 'placeholder';
  figure.innerHTML = '';
  if (image) {
    var img = figure.appendChild(h('<img>'));
    img.src = image;
    img.alt = type;
  } else {
    figure.innerHTML = ICON.gauge;
  }
  var hw = state.client['deviceInfo.hwVersion'] || state.server['register.hwVersion'], fw = firmwareOf();
  var sub = cardEl.querySelector('.ts-subtitle');
  sub.innerHTML = '';
  var parts = [d.name];
  if (type && !(hw && String(hw).toLowerCase().indexOf(type.toLowerCase()) === 0)) { parts.push(type.toUpperCase()); }
  if (hw) { parts.push(family() === 'bus' ? hw : t('device.hardwareVersion', 'hardware {v}', { v: hw })); }
  if (fw) { parts.push(t('device.firmwareVersion', 'firmware {v}', { v: fw })); }
  sub.appendChild(document.createTextNode(parts.join(' · ')));
  if (fw || hw) { updateChip(sub.appendChild(h('<span class="ts-dev-update"></span>')), hw, fw); }
}

/** The service chips and the silence banner for everyone; *Silence* and the row menu for a writer. */
function renderService() {
  var sv = tb.serviceOf(state.server), until = !sv.state && sv.silencedUntil;
  chipsEl.innerHTML = '';
  life.deviceChips(state.server).forEach(function (c) { chipsEl.appendChild(c); });
  if (until) {
    var banner = bodyEl.appendChild(h('<div class="ts-banner ts-dev-silence">' + ICON.mute + '<span class="ts-grow"></span></div>'));
    banner.querySelector('span').textContent = sv.silencedBy
      ? t('device.silenceNoteBy', '{silence} by {name}: device alarms are raised and shown, nobody is notified.', { silence: ui.silenceText(until), name: sv.silencedBy })
      : t('device.silenceNote', '{silence}: device alarms are raised and shown, nobody is notified.', { silence: ui.silenceText(until) });
    if (state.writable) {
      banner.appendChild(h('<button type="button" class="ts-btn" data-a="end-silence">' + esc(t('common.endSilence', 'End now')) + '</button>'))
        .addEventListener('click', function () { life.endSilence(deviceEntity(), refresh); });
    }
  }
  actsEl.innerHTML = '';
  if (!state.writable) { return; }
  if (!sv.state) {
    var silence = actsEl.appendChild(h('<button type="button" class="ts-btn" data-a="silence">' + ICON.mute + '<span>' + esc(t('common.silence', 'Silence')) + '</span></button>'));
    silence.addEventListener('click', function () { life.silenceMenu(silence, deviceEntity(), refresh); });
  }
  actsEl.appendChild(ui.rowMenu(function () {
    return [
      { a: 'replace', label: t('device.replaceItem', 'Replace device…'), run: replaceDrawer },
      life.serviceItem(deviceEntity(), state.server, refresh)
    ];
  }, { title: t('device.actions', 'Device actions') }));
}

function firmwareOf() { return state.client['deviceInfo.fwVersion'] || null; }

/** "Update available" beside the versions when the firmware index holds a newer release for the device's board. */
function updateChip(el, hw, fw) {
  window.TerrySenseFirmwareIndex.load().then(function (index) {
    var up = window.TerrySenseFirmwareIndex.updateFor(index, hw, fw);
    if (!up) { return; }
    el.className = 'ts-dev-update ts-chip accent';
    el.textContent = !up.version ? t('device.updateNewer', 'newer firmware available')
      : up.final ? t('device.updateAvailable', '{version} available', { version: up.version })
        : t('device.updatePreRelease', '{version} available · pre-release', { version: up.version });
  }).catch(function () {});
}

// -- health (TC-3, TC-6) ------------------------------------------------------------------

/** The verdict first and alone in its colour, then one summary line per area, the raw values in a closed *Details*. */
function healthStrip() {
  var strip = h('<section class="ts-dev-health" data-health="1"></section>');
  strip.appendChild(verdictTile(verdict()));
  [batteryTile(), radioTile(), reportingTile(), sdTile()].forEach(function (tile) { if (tile) { strip.appendChild(tile); } });
  var details = detailsPart();
  if (details) { strip.appendChild(details); }
  return strip;
}

/** One status: not active or faulting in red, what a person should check in orange, else green. */
function verdict() {
  var active = truthyFlag(state.server.active), fam = family();
  if (!active) {
    return { level: 'fault', title: t('device.notActiveTitle', 'Not active'),
             lines: [t('device.notActiveSince', 'No uplink within the inactivity timeout; the last one {ago}.', { ago: t.ago(state.server.lastActivityTime) })] };
  }
  if (fam === 'bus') {
    var faulting = faultingSources();
    if (faulting.length) {
      return { level: 'fault', title: faulting.length === 1 ? t('device.faultingTitleOne', '1 measurement faulting') : t('device.faultingTitleMany', '{n} measurements faulting', { n: faulting.length }),
               lines: faulting.slice(0, 3).map(function (f) { return f.text; }) };
    }
  }
  var checks = [];
  if (fam !== 'bus') {
    registerRows().forEach(function (r) {
      if (!r.warn) { return; }
      checks.push(r.key === 'register.intervalSeconds' ? t('device.checkInterval', 'No measurement interval is set.')
        : t('device.checkRegister', '{field} reads {value}.', { field: r.label, value: r.value }));
    });
  }
  var unstored = measurementRows().filter(function (r) { return r.unstored; }).length;
  var silent = measurementRows().filter(function (r) { return r.el.dataset.state === 'waiting'; }).length;
  if (silent) { checks.push(silent === 1 ? t('device.checkWaitingOne', '1 measurement set to send has sent nothing yet.') : t('device.checkWaitingMany', '{n} measurements set to send have sent nothing yet.', { n: silent })); }
  if (!state.bindings.length) { checks.push(t('device.storedOnDeviceOnly', 'Its readings are stored on the device only.')); }
  else if (unstored) { checks.push(unstored === 1 ? t('device.checkUnstoredOne', '1 measurement is stored on no station.') : t('device.checkUnstoredMany', '{n} measurements are stored on no station.', { n: unstored })); }
  if (checks.length) {
    return { level: 'warn', title: checks.length === 1 ? t('device.checkTitleOne', 'Live, 1 thing to check') : t('device.checkTitleMany', 'Live, {n} things to check', { n: checks.length }), lines: checks };
  }
  return { level: 'ok', title: fam === 'bus' ? t('device.liveNoFault', 'Live, no peripheral fault.') : t('device.live', 'Live.'),
           lines: [t('device.allStored', 'Every measurement is live and stored.')] };
}

/** The sources whose latest reading is a fault, or that carry an active `peripheralFault` alarm, in bus order. */
function faultingSources() {
  var nodes = topology(), out = [];
  sources().slice().sort(function (a, b) { return a.position - b.position || a.sourceKey.localeCompare(b.sourceKey); }).forEach(function (s) {
    var st = sourceState(s);
    if (st.state !== 'fault' && !state.faults[s.sourceKey]) { return; }
    var node = nodes[s.position], p = node && state.peripherals[node.type];
    var where = s.position === 0 ? t('mapping.logrItself', 'LOGR itself') : p ? p.displayName : t('device.atPosition', 'position {pos}', { pos: s.position });
    var reason = st.state === 'fault' ? (G.STATUS_CODES[st.code] || t('device.unknownStatusCode', 'Unknown status code')) + ' (' + st.code + ')' : t('device.faultAlarmTip', 'Active peripheralFault alarm');
    out.push({ key: s.sourceKey, text: st.state === 'fault'
      ? t('device.faultLine', '{measurement} on {peripheral}: {reason}, since {time}.', { measurement: sourceLabel(s, node), peripheral: where, reason: reason, time: ui.when(st.ts) })
      : t('device.alarmLine', '{measurement} on {peripheral}: {reason}.', { measurement: sourceLabel(s, node), peripheral: where, reason: reason }) });
  });
  return out;
}

function verdictTile(v) {
  var el = h('<div class="ts-dev-verdict"><div class="ts-dev-tile-label"></div><div class="ts-dev-verdict-title"></div></div>');
  el.dataset.level = v.level;
  el.querySelector('.ts-dev-tile-label').textContent = t('device.status', 'Status');
  el.querySelector('.ts-dev-verdict-title').textContent = v.title;
  v.lines.forEach(function (l) { el.appendChild(h('<div class="ts-dev-verdict-line"></div>')).textContent = l; });
  return el;
}

function tile(id, label, value, sub, level) {
  var el = h('<div class="ts-dev-tile"><div class="ts-dev-tile-label"></div><div class="ts-dev-tile-value"></div><div class="ts-dev-tile-sub"></div></div>');
  el.dataset.tile = id;
  el.querySelector('.ts-dev-tile-label').textContent = label;
  var v = el.querySelector('.ts-dev-tile-value');
  [].concat(value).forEach(function (x) { v.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
  if (level) { v.dataset.level = level; }
  var s = el.querySelector('.ts-dev-tile-sub');
  [].concat(sub || []).forEach(function (x) { s.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
  return el;
}

/** How often the device sends and how many measurements it subscribes, then its last uplink. */
function reportingTile() {
  var last = state.server.lastActivityTime, fam = family();
  var every = fam === 'bus' ? Number(state.client['status.baseIntervalSeconds']) : Number(state.server['register.intervalSeconds']);
  var subs = fam === 'bus' ? sources().filter(subscribed) : null;
  var n = subs ? subs.filter(function (s) { return !(s.enabled === false || s.enabled === 'false'); }).length : readings().length;
  var value = every > 0 ? t('device.everyDuration', 'every {d}', { d: fmtDuration(every) })
    : fam === 'bus' ? t('device.notReported', 'Not reported') : t('device.intervalNotSet', 'interval not set');
  // A LOGR whose SUBSCRIPTIONS report never arrived names no subscription: that says nothing of what it measures.
  var sub = [subs && !subs.length ? t('device.noSubscriptionsReport', 'no report yet')
    : n === 1 ? t('device.measurementOne', '1 measurement') : t('device.measurementMany', '{n} measurements', { n: n }),
    last ? t('device.lastUplinkAgo', 'last uplink {ago}', { ago: t.ago(last) }) : t('device.noUplinkYet', 'no uplink yet')].join(' · ');
  return tile('reporting', t('device.statReporting', 'Reporting'), value, sub);
}

/** What the battery holds, as the LOGR states it: charge, voltage, the runtime it estimates, charging and from what. */
function batteryFacts() {
  var c = state.client, lat = state.latest, hasStatus = c['status.baseIntervalSeconds'] !== undefined;
  var unread = hasStatus && powerUnread(c);
  var socUnread = unread || c['status.soc'] === UNKNOWN;
  var soc = c['status.soc'] !== undefined && !socUnread ? Number(c['status.soc']) : (lat['p0.percent'] ? Number(lat['p0.percent'].value) : undefined);
  var volt = BATTERY_VOLTAGE.map(function (k) { return lat[k]; }).filter(Boolean)[0];
  var runtime = !unread && Number(c['status.battRuntimeSeconds']) > 0 ? Number(c['status.battRuntimeSeconds']) : 0;
  var charging = c['status.charging'] !== undefined && c['status.charging'] !== UNKNOWN && !unread ? truthyFlag(c['status.charging']) : null;
  var ttf = charging && Number(c['status.ttfSeconds']) > 0 ? Number(c['status.ttfSeconds']) : 0;
  var source = !unread && c['status.activeSource'] !== undefined && c['status.activeSource'] !== UNKNOWN ? c['status.activeSource'] : null;
  return { soc: isFinite(soc) ? soc : undefined, socUnread: socUnread, volt: volt, runtime: runtime, charging: charging, ttf: ttf, source: source };
}

/** The charge, then charging and the power input in one line: "Charging from internal solar, full in 90 min · lasts about 45 days". */
function batteryTile() {
  var b = batteryFacts(), names = powerSources();
  if (b.soc === undefined && !b.volt) {
    return family() === 'bus' ? tile('battery', t('common.battery', 'Battery'), t('device.notReported', 'Not reported'),
      b.socUnread ? t('fleet.chargeUnread', 'charge not reported') : '') : null;
  }
  var from = b.source && b.source !== 'none' ? (names[b.source] || b.source) : null;
  var power = b.charging ? (from ? (b.ttf ? t('device.chargingFromFull', 'Charging from {source}, full in {d}', { source: from, d: fmtDuration(b.ttf) })
      : t('device.chargingFrom', 'Charging from {source}', { source: from }))
      : b.ttf ? t('device.chargingFullIn', 'Charging, full in {d}', { d: fmtDuration(b.ttf) }) : t('device.charging', 'Charging'))
    : b.charging === false ? (from ? t('device.onSourceNotCharging', 'On {source}, not charging', { source: from }) : b.source === 'none' ? t('device.onBattery', 'On battery') : t('device.notCharging', 'Not charging'))
      : '';
  var sub = [power, b.runtime ? t('device.lastsAbout', 'lasts about {d}', { d: fmtDuration(b.runtime) }) : ''].filter(Boolean).join(' · ');
  if (b.soc === undefined) { return tile('battery', t('common.battery', 'Battery'), fmtValue(b.volt.value) + ' V', sub || t.ago(b.volt.ts)); }
  var el = tile('battery', t('common.battery', 'Battery'), fmtValue(b.soc) + ' %', sub, b.soc < 20 ? 'poor' : b.soc < 40 ? 'fair' : null);
  var bar = el.insertBefore(h('<div class="ts-dev-bar"><span></span></div>'), el.querySelector('.ts-dev-tile-sub'));
  bar.firstChild.style.width = Math.max(0, Math.min(100, b.soc)) + '%';
  bar.dataset.level = b.soc < 20 ? 'poor' : b.soc < 40 ? 'fair' : 'good';
  return el;
}

var LEVEL_ORDER = { good: 0, fair: 1, poor: 2 };

/** The worst of uplink RSSI, SNR and spreading factor and the downlink's, as one word, and the gateways that heard it. */
function radioTile() {
  var lat = state.latest, c = state.client;
  var sf = state.server.spreadingFactor !== undefined ? state.server.spreadingFactor : c.spreadingFactor;
  var levels = [];
  if (lat.rssi) { levels.push(rssiLevel(lat.rssi.value)); }
  if (lat.snr) { levels.push(snrLevel(lat.snr.value)); }
  if (sf !== undefined) { levels.push(sfLevel(sf)); }
  if (c['status.dlRssi'] !== undefined) { levels.push(rssiLevel(c['status.dlRssi']), snrLevel(c['status.dlSnr'])); }
  var gws = parseJson(c.gateways || state.server.gateways) || [];
  levels = levels.filter(Boolean);
  if (!levels.length) { return null; }
  var worst = levels.sort(function (a, b) { return LEVEL_ORDER[b] - LEVEL_ORDER[a]; })[0];
  var word = { good: t('device.radioGood', 'Good'), fair: t('device.radioFair', 'Fair'), poor: t('device.radioPoor', 'Poor') }[worst];
  var sub = gws.length ? (gws.length === 1 ? t('fleet.gatewayOne', '1 gateway') : t('fleet.gatewayMany', '{n} gateways', { n: gws.length })) : '';
  return tile('radio', t('fleet.radio', 'Radio'), word, sub, worst);
}

/** The SD card, only when one is in the LOGR: its fill, or its fault. */
function sdTile() {
  var c = state.client, sd = c['status.sdState'];
  if (sd !== 'ready' && sd !== 'fault') { return null; }
  if (sd === 'fault') { return tile('sd', t('device.statSd', 'SD card'), sdStates().fault, '', 'poor'); }
  return tile('sd', t('device.statSd', 'SD card'), t('device.sdUsedShort', '{used} % used', { used: fmtValue(c['status.sdUsedPercent']) }),
    t('device.sdOf', 'of {total} GiB', { total: c['status.sdTotalGib'] }));
}

// -- measurements (TC-1, TC-2, TC-4, TC-5) -------------------------------------------------

/** Every measurement row of the last render, `{el, attention, unstored}`, for the counts and the filter. */
var lastRows = [];
function measurementRows() { return lastRows; }

var FILTERS = ['all', 'attention', 'unstored'];

/** One table: a header per position or sensor stating its verdict, a line per measurement with its
 * latest value and state, and at the foot of each a closed *Configure*. On a narrow card each line is a list item. */
function measurementsSection() {
  var fam = family(), bus = fam === 'bus';
  var sec = h('<section class="ts-dev-meas" data-section="measurements"><div class="ts-dev-sec-head"><h3 class="ts-dev-h"></h3>' +
    '<div class="ts-seg" role="group"></div><span class="ts-spacer"></span></div><div class="ts-dev-banners"></div>' +
    '<div class="ts-mtable"></div></section>');
  sec.setAttribute('data-title', t('settings.measurements', 'Measurements'));
  sec.querySelector('.ts-dev-h').textContent = t('settings.measurements', 'Measurements');
  var head = sec.querySelector('.ts-dev-sec-head');
  if (fam === 'logr2') {
    var fixed = head.insertBefore(h('<span class="ts-chip" data-fixed="1"></span>'), head.querySelector('.ts-seg'));
    fixed.title = t('device.fixedTip', 'Set in the LOGR2 firmware: nothing to configure from the cloud');
    fixed.textContent = t('device.fixedSensors', 'sensors fixed in firmware');
  }
  var table = sec.querySelector('.ts-mtable');
  table.classList.toggle('bus', bus);
  table.classList.toggle('editing', bus && state.writable);
  var cols = bus ? [t('common.measurement', 'Measurement'), t('device.colLatest', 'Latest'), t('fleet.state', 'State')]
    : [t('common.measurement', 'Measurement'), t('device.colLatest', 'Latest')];
  var thead = table.appendChild(h('<div class="ts-mhead"></div>'));
  cols.forEach(function (c) { thead.appendChild(h('<div></div>')).textContent = c; });

  var groups = bus ? busGroups(sec.querySelector('.ts-dev-banners')) : partGroups();
  lastRows = [];
  groups.forEach(function (g) { g.close(); lastRows = lastRows.concat(g.rows); });
  var counts = { all: lastRows.length, attention: 0, unstored: 0 };
  lastRows.forEach(function (r) { if (r.attention) { counts.attention++; } if (r.unstored) { counts.unstored++; } });
  var filter = !counts[state.filter] ? 'all' : state.filter;
  var seg = sec.querySelector('.ts-seg');
  var names = { all: t('common.all', 'All'), attention: t('fleet.needsLook', 'Needs a look'), unstored: t('device.filterNotStored', 'Not stored') };
  FILTERS.forEach(function (f) {
    if (f !== 'all' && !counts[f]) { return; }
    var b = seg.appendChild(h('<button type="button" class="ts-seg-btn"><span></span> <b></b></button>'));
    b.dataset.filter = f;
    b.classList.toggle('on', f === filter);
    b.firstChild.textContent = names[f];
    b.querySelector('b').textContent = counts[f];
    b.addEventListener('click', function () { state.filter = f; render(); });
  });
  if (seg.childNodes.length < 2) { seg.remove(); }

  groups.forEach(function (g) {
    var shown = 0;
    g.rows.forEach(function (r) {
      var on = filter === 'all' || r[filter];
      r.el.hidden = !on;
      if (on) { shown++; }
    });
    g.el.hidden = filter !== 'all' && !shown;
    table.appendChild(g.el);
  });
  if (!groups.length) {
    table.appendChild(h('<div class="ts-empty"></div>')).textContent = bus ? t('device.noPeripheral', 'No peripheral reported yet.') : t('device.nothingMeasured', 'Nothing measured by this device yet.');
  }
  if (bus && state.writable) { sec.appendChild(editBar()); }
  return sec;
}

/** A group of lines under a header that folds, opened as the reader last left it, at first closed unless `open`:
 * a position, a LOGR2 sensor, a device's readings. Each line's keys, wiring and controls go into the group's closed *Configure*. */
function group(id, open) {
  var el = memo.bind(h('<details class="ts-mgroup fold"><summary class="ts-mgroup-head"></summary></details>'), 'group.' + id, !!open);
  var head = el.querySelector('.ts-mgroup-head');
  head.innerHTML = '<span class="ts-pos-chev">' + ICON.chev + '</span>' +
    '<span class="ts-pos-num"></span><span class="ts-mgroup-name"></span><span class="ts-mono"></span><span class="ts-pos-flags"></span>' +
    '<span class="ts-spacer"></span><span class="ts-mgroup-sum"></span><span class="ts-mgroup-verdict"></span><span class="ts-mgroup-acts"></span>';
  var conf = h('<details class="ts-mconf"><summary class="ts-mconf-head"><span class="ts-pos-chev">' + ICON.chev + '</span>' +
    '<span class="ts-mconf-title"></span><span class="ts-mconf-flags"></span></summary><div class="ts-mconf-body"></div></details>');
  conf.dataset.conf = id;
  conf.querySelector('.ts-mconf-title').textContent = state.writable ? t('device.configure', 'Configure') : t('device.details', 'Details');
  memo.bind(conf, placeOf('conf.' + id));
  var confBody = conf.querySelector('.ts-mconf-body');
  function flag(cls, text, attr) {
    var c = head.querySelector('.ts-pos-flags').appendChild(h('<span class="ts-chip' + (cls ? ' ' + cls : '') + '"></span>'));
    c.textContent = text;
    if (attr) { c.setAttribute(attr[0], attr[1]); }
    return c;
  }
  return {
    el: el, rows: [], flag: flag,
    num: function (v, cls) {
      var n = head.querySelector('.ts-pos-num');
      if (v === null || v === undefined) { n.remove(); return; }
      n.textContent = v;
      if (cls) { n.classList.add(cls); }
    },
    name: function (v) { head.querySelector('.ts-mgroup-name').textContent = v; },
    mono: function (v) { head.querySelector('.ts-mono').textContent = v || ''; },
    sum: function (v) { head.querySelector('.ts-mgroup-sum').textContent = v || ''; },
    /** The group's own state, after its count: "OK", "Fault since 12:04". */
    verdict: function (cls, text) {
      var c = head.querySelector('.ts-mgroup-verdict').appendChild(h('<span class="ts-chip"></span>'));
      if (cls) { c.classList.add(cls); }
      c.dataset.verdict = cls || 'none';
      c.textContent = text;
    },
    /** A chip on the closed *Configure*'s header: what it holds that needs a look. */
    confFlag: function (cls, text, attr) {
      var c = conf.querySelector('.ts-mconf-flags').appendChild(h('<span class="ts-chip' + (cls ? ' ' + cls : '') + '"></span>'));
      c.textContent = text;
      if (attr) { c.setAttribute(attr[0], attr[1]); }
      return c;
    },
    /** A tool on the header itself, one click from first sight: a LOGR2 sensor's *Delete data*. */
    act: function (html, fn) {
      var b = head.querySelector('.ts-mgroup-acts').appendChild(h(html));
      b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); fn(); });
      return b;
    },
    /** A tool at the foot of the *Configure*: add a measurement. */
    confAct: function (html, fn) {
      var foot = confBody.querySelector('.ts-mconf-foot') || confBody.appendChild(h('<div class="ts-mconf-foot"></div>'));
      var b = foot.appendChild(h(html));
      b.addEventListener('click', function (e) { e.preventDefault(); fn(); });
      return b;
    },
    confNote: function (text, attr) {
      var n = confBody.appendChild(h('<div class="ts-mconf-note"></div>'));
      n.textContent = text;
      if (attr) { n.setAttribute(attr[0], attr[1]); }
      return n;
    },
    add: function (row) {
      if (row.el) { el.appendChild(row.el); this.rows.push(row); }
      if (row.conf) { confBody.insertBefore(row.conf, confBody.querySelector('.ts-mconf-note, .ts-mconf-foot')); }
    },
    /** Hangs the *Configure* under the lines, its header naming the lines stored nowhere and the changes queued. */
    close: function () {
      if (!confBody.childNodes.length) { return; }
      var unstored = this.rows.filter(function (r) { return r.unstored; }).length;
      var queued = confBody.querySelectorAll('[data-queued]').length;
      if (unstored) { this.confFlag('warn', unstored === 1 ? t('device.notStoredOne', '1 not stored') : t('device.notStoredMany', '{n} not stored', { n: unstored }), ['data-unstored', String(unstored)]); }
      if (queued) { this.confFlag('accent', t('device.changeQueued', 'change queued'), ['data-queued-count', String(queued)]); }
      if (confBody.querySelector('.ts-mrow.changed')) { this.confFlag('accent', t('device.notSentYet', 'not sent yet'), ['data-drafted', '1']); }
      el.appendChild(conf);
    }
  };
}

/** One measurement line: name, latest, state (bus). */
function mrow(bus) {
  return h('<div class="ts-mrow"><div class="ts-mc ts-mc-name"><div class="ts-row-label"></div></div><div class="ts-mc ts-mc-latest"></div>' +
    (bus ? '<div class="ts-mc ts-mc-state"></div>' : '') + '</div>');
}

/** One line of a *Configure*: the measurement and its key, its interval (bus), the station channel it feeds. */
function crow(bus) {
  return h('<div class="ts-mrow ts-crow"><div class="ts-mc ts-mc-name"><div class="ts-row-label"></div></div>' +
    (bus ? '<div class="ts-mc ts-mc-every"></div>' : '') + '<div class="ts-mc ts-mc-store"></div></div>');
}

function nameSub(row, text, cls) {
  var el = row.querySelector('.ts-mc-name').appendChild(h('<div class="ts-mc-sub"></div>'));
  if (cls) { el.classList.add(cls); }
  el.textContent = text;
  return el;
}

function latestCell(row, value, unit, meta, cls) {
  var cell = row.querySelector('.ts-mc-latest');
  var v = cell.appendChild(h('<div class="ts-mvalue"><b></b> <span class="ts-munit"></span></div>'));
  v.querySelector('b').textContent = value;
  if (cls) { v.classList.add(cls); }
  v.querySelector('.ts-munit').textContent = unit || '';
  if (meta) { cell.appendChild(h('<div class="ts-row-meta"></div>')).textContent = meta; }
}

function stateChip(row, cls, text, st) {
  var cell = row.querySelector('.ts-mc-state');
  var chip = cell.appendChild(h('<span class="ts-chip ts-mstate"><span class="ts-dot"></span><span class="ts-mstate-text"></span></span>'));
  if (cls) { chip.classList.add(cls); }
  chip.dataset.s = st;
  chip.querySelector('.ts-mstate-text').textContent = text;
  return cell;
}

/** Where a measurement is stored: each station channel it feeds; for a writer the way to change it. */
function storeCell(row, key, diagnostic, earlier) {
  var feeds = state.wiring[key] || [], r = state.writable && storable[key];
  // An earlier peripheral's reading can only leave the stations that store it.
  if (earlier && !feeds.length) { r = null; }
  var cell = row.querySelector('.ts-mc-store');
  var wire = cell.appendChild(h('<div class="ts-wire"></div>'));
  if (feeds.length) {
    wire.dataset.wired = '1';
    feeds.forEach(function (f) {
      var to = wire.appendChild(h('<span class="ts-wire-to"><b></b> › <span></span></span>'));
      to.querySelector('b').textContent = f.station;
      to.lastChild.textContent = f.label ? t.label(f.channel, f.label, state.names) : f.channel;
      to.title = f.channel;
    });
  } else if (!diagnostic) {
    wire.dataset.wired = '0';
    if (!r) { wire.appendChild(h('<span class="ts-wire-none"></span>')).textContent = t('common.notStored', 'not stored'); }
  } else {
    var only = wire.appendChild(h('<span class="ts-chip ts-device-only">' + ICON_DEVICE + '<span></span></span>'));
    only.lastChild.textContent = t('device.deviceOnly', 'Device only');
    only.title = t('device.deviceOnlyTip', 'A measurement about the LOGR itself: it stays on the device unless a station stores it');
  }
  if (r) {
    var quiet = feeds.length || diagnostic;
    var b = wire.appendChild(quiet
      ? h('<button type="button" class="ts-icon-btn" data-a="store">' + ICON.edit + '</button>')
      : h('<button type="button" class="ts-btn sm ts-store-btn" data-a="store"></button>'));
    if (quiet) { b.title = feeds.length ? t('common.stations', 'Stations') : t('device.storeOnStation', 'Store on a station…'); }
    else { b.textContent = t('device.storeOnStation', 'Store on a station…'); }
    b.addEventListener('click', function () { storeDrawer(r); });
  }
  return !diagnostic && !earlier && !feeds.length;
}

/** A source: its line with the state from its latest readings; in the *Configure*, its key, subscription and wiring. */
function sourceRow(s, node, diagnostic) {
  var st = sourceState(s);
  var row = mrow(true), conf = crow(true);
  row.dataset.source = s.sourceKey;
  row.dataset.state = st.state;
  row.title = s.sourceKey;
  conf.dataset.confSource = s.sourceKey;
  row.querySelector('.ts-row-label').textContent = sourceLabel(s, node);
  conf.querySelector('.ts-row-label').textContent = sourceLabel(s, node);
  nameSub(conf, s.sourceKey, 'ts-mono');
  var unit = unitOf(s), v = state.latest[s.sourceKey];
  if (st.state === 'fault') {
    row.dataset.since = st.ts;
    nameSub(row, (G.STATUS_CODES[st.code] || t('device.unknownStatusCode', 'Unknown status code')) + ' (' + st.code + ')', 'ts-tsrc-why');
    latestCell(row, '—', '', v ? t('device.lastValueAt', 'last {value} at {time}', { value: fmtValue(v.value) + (unit ? ' ' + unit : ''), time: ui.when(v.ts) })
      : t('device.faultSince', 'since {time}', { time: ui.when(st.ts) }), 'fault');
    stateChip(row, 'fault', t('device.faultChip', 'Fault'), 'fault');
  } else if (st.state === 'ok') {
    latestCell(row, fmtValue(st.value), unit, t.ago(st.ts));
    stateChip(row, 'ok', t('common.ok', 'OK'), 'ok');
  } else if (st.state === 'disabled') {
    latestCell(row, '—', '', t('device.switchedOff', 'sending switched off'));
    stateChip(row, '', t('common.off', 'Off'), 'disabled');
  } else {
    latestCell(row, '—', '', t('device.nothingReceived', 'set to send, nothing received yet'));
    stateChip(row, 'warn', t('device.noReading', 'No reading'), 'waiting');
  }
  if (state.faults[s.sourceKey]) {
    row.querySelector('.ts-mc-state').appendChild(h('<span class="ts-chip fault" data-alarm="1">' + ICON.bell + '</span>')).title = t('device.faultAlarmTip', 'Active peripheralFault alarm');
  }
  everyCell(conf.querySelector('.ts-mc-every'), s, conf, node);
  var attention = st.state === 'fault' || st.state === 'waiting' || !!state.faults[s.sourceKey], unstored = false;
  if (s.kind === 'drycStatus') { attention = drycCells(row, 'p' + s.position + '.', s.position) || attention; }
  else { unstored = storeCell(conf, s.sourceKey, diagnostic); }
  return { el: row, conf: conf, attention: attention, unstored: unstored };
}

/** A reading that is no subscribed source: a LOGR2 or another device's key, a DRYC's unpacked field. */
function readingRow(key, diagnostic, bus) {
  var v = state.latest[key];
  var row = mrow(bus), conf = crow(bus);
  row.dataset.reading = key;
  row.title = key;
  conf.dataset.confReading = key;
  row.querySelector('.ts-row-label').textContent = labelOf(key);
  conf.querySelector('.ts-row-label').textContent = labelOf(key);
  nameSub(conf, key + (entryOf(key) ? '' : ' · ' + t('device.notInDictionary', 'not in the vocabulary')), 'ts-mono');
  latestCell(row, fmtValue(v.value), readingUnit(key), t.ago(v.ts));
  var unstored = storeCell(conf, key, diagnostic);
  return { el: row, conf: conf, attention: false, unstored: unstored };
}

/** A group's verdict from its lines: "Fault since 12:04", "2 faulting", "1 without reading", else "OK". */
function groupVerdict(g) {
  var faulting = g.rows.filter(function (r) { return r.el.dataset.state === 'fault' || r.el.querySelector('[data-alarm]'); });
  var waiting = g.rows.filter(function (r) { return r.el.dataset.state === 'waiting'; }).length;
  if (faulting.length === 1 && faulting[0].el.dataset.since) {
    g.verdict('fault', t('device.faultSinceTitle', 'Fault since {time}', { time: ui.when(Number(faulting[0].el.dataset.since)) }));
  } else if (faulting.length) {
    g.verdict('fault', t('device.faultingCount', '{n} faulting', { n: faulting.length }));
  } else if (waiting) {
    g.verdict('warn', waiting === 1 ? t('device.noReading', 'No reading') : t('device.withoutReadingMany', '{n} without reading', { n: waiting }));
  } else if (g.rows.some(function (r) { return r.el.dataset.state === 'ok' || r.el.dataset.reading; })) {
    g.verdict('ok', t('common.ok', 'OK'));
  }
}

// -- bus groups ---------------------------------------------------------------------------

/** The LOGR itself, then the positions in bus order, a removed one after the live ones, then the former positions, all folded at first. */
function busGroups(banners) {
  var nodes = topology(), srcs = sources(), out = [];
  var positions = {};
  Object.keys(nodes).forEach(function (p) { positions[p] = true; });
  srcs.forEach(function (s) { positions[s.position] = true; });
  delete positions[0];
  busMoves(nodes, srcs).forEach(function (m) { banners.appendChild(moveBanner(m)); });
  // A complete TOPOLOGY report leaves out a removed position (TRX_NANO.md §1.3); before any, absence says nothing.
  var reported = state.client['topology.frame'] !== undefined, removed = [], former = [];
  out.push(positionGroup(0, nodes[0] || logrNode(), srcs));
  Object.keys(positions).map(Number).sort(function (a, b) { return a - b; }).forEach(function (pos) {
    if (nodes[pos] || !reported) { out.push(positionGroup(pos, nodes[pos], srcs)); return; }
    var own = srcs.filter(function (s) { return s.position === pos; });
    (own.length && own.every(silentSource) ? former : removed).push(pos);
  });
  removed.forEach(function (pos) { out.push(positionGroup(pos, null, srcs, true)); });
  if (former.length) { out.push(formerGroup(former, srcs)); }
  return out;
}

/** Position 0 as its catalog entry, `logr-3` or `logr-4` by device type: the TOPOLOGY report lists the external positions only. */
function logrNode() {
  return { position: 0, type: String(state.device.type).replace(/^logr(\d)$/, 'logr-$1') };
}

function positionGroup(pos, node, srcs, removed) {
  var here = srcs.filter(function (s) { return s.position === pos; }).sort(function (a, b) { return a.sourceKey.localeCompare(b.sourceKey); });
  var earlier = removed ? [] : here.filter(function (s) { return M.fromEarlier(model(), s, node); });
  var own = here.filter(function (s) { return earlier.indexOf(s) < 0; });
  // Once the device has reported its subscriptions, a source with readings it no longer subscribes stopped.
  var reported = state.client['subscriptions.frame'] !== undefined;
  var stopped = removed || !reported ? [] : own.filter(function (s) { return !subscribed(s) && s.kind !== 'drycStatus'; });
  var live = own.filter(function (s) { return stopped.indexOf(s) < 0; });
  var g = group('p' + pos);
  g.el.dataset.position = pos;
  g.num(pos);
  var p = node && state.peripherals[node.type];
  g.name(pos === 0 ? t('mapping.logrItself', 'LOGR itself')
    : removed ? t('device.removedFromBus', 'Removed from the bus')
    : (p ? p.displayName : node ? node.type : t('mapping.unknownPeripheral', 'Unknown peripheral')));
  g.mono(node ? node.type + (node.version !== undefined && node.version !== null ? ' · v' + node.version : '')
    : removed && own.length ? t('device.lastReading', 'last reading {when}', { when: ui.when(newestTs(own)) }) : '');
  var dryc = pos !== 0 && !!node && /^dryc/.test(node.type);
  var fields = dryc ? drycFields(pos) : [];
  var odd = false;
  if (removed) {
    g.el.dataset.removed = '1';
    odd = true;
    var gone = positionKeys(pos);
    if (state.writable && gone.length) {
      g.act('<button type="button" class="ts-btn danger" data-a="delete-position">' + esc(t('device.deleteData', 'Delete data')) + '</button>', function () {
        deleteData(t('device.removedPosition', 'removed position {pos}', { pos: pos }), gone);
      });
    }
  }
  else if (!node) { g.flag('warn', t('device.notInTopology', 'not in the topology report')); odd = true; }
  else if (!p && pos !== 0) { g.flag('warn', t('device.notInCatalog', 'not in the catalog')); odd = true; }
  var added = {};
  state.adds.forEach(function (a) { added[a.sourceKey] = true; });
  var more = unsubscribed(pos, node, own).filter(function (o) { return !added[o.sourceKey]; });
  live.forEach(function (s) { g.add(sourceRow(s, node, M.diagnostic(model(), s, node))); });
  // A DRYC's inputs, relays and rules belong to its own view: one row of their state, which opens it.
  if (dryc && fields.length && !own.some(function (s) { return s.kind === 'drycStatus'; })) { g.add(drycRow('p' + pos + '.', pos, true)); }
  addedRows(pos).forEach(function (r) { g.add(r); });
  if (!g.rows.length) {
    var empty = mrow(true);
    empty.classList.add('empty');
    empty.querySelector('.ts-row-label').textContent = t('device.positionEmpty', 'Nothing sent and no reading from this position.');
    g.add({ el: empty, attention: odd, unstored: false });
  }
  if (odd) {
    g.el.classList.add('odd');
    g.rows.forEach(function (r) { r.attention = true; });
  }
  if (!removed) {
    var sent = live.filter(function (s) { return !(s.enabled === false || s.enabled === 'false'); }).length, parts = [];
    if (own.length || more.length) { parts.push(t('device.sentCount', '{n} sent', { n: sent })); }
    if (stopped.length) { parts.push(t('device.noLongerSentCount', '{n} no longer sent', { n: stopped.length })); }
    if (more.length) { parts.push(t('device.notSentCount', '{n} not sent', { n: more.length })); }
    g.sum(parts.join(' · '));
    g.el.dataset.sent = sent;
    g.el.dataset.notSent = more.length;
  }
  if (stopped.length) { g.add({ conf: leftoverPart('stopped', pos, stopped, node, false) }); }
  if (more.length) { g.add({ conf: notSentPart(pos, more) }); }
  if (earlier.length) {
    var stored = earlier.some(function (s) { return (state.wiring[s.sourceKey] || []).length; });
    if (stored) {
      g.flag('warn', t('device.earlierStored', 'earlier readings still stored'));
      g.confFlag('warn', t('device.earlierStored', 'earlier readings still stored'));
    }
    g.add({ conf: leftoverPart('earlier', pos, earlier, null, stored) });
  }
  if (!removed) { groupVerdict(g); }
  return g;
}

/** A folded part of a position's *Configure*: its title, a hint and a count, opened as the reader last left it. */
function confPart(place, title, hint, count, open) {
  var el = memo.bind(h('<details class="ts-mconf-part"><summary class="ts-mconf-part-head"><span class="ts-pos-chev">' + ICON.chev + '</span>' +
    '<span class="ts-mconf-part-title"></span><span class="ts-mconf-part-hint"></span><span class="ts-spacer"></span>' +
    '<span class="ts-mgroup-acts"></span><span class="ts-mconf-part-count"></span></summary></details>'), placeOf(place), open);
  el.querySelector('.ts-mconf-part-title').textContent = title;
  el.querySelector('.ts-mconf-part-hint').textContent = hint || '';
  el.querySelector('.ts-mconf-part-count').textContent = String(count);
  return el;
}

/** The catalog measures of a position the LOGR does not subscribe; for a writer, each with its interval and *Subscribe*. */
function notSentPart(pos, list) {
  var el = confPart('notSent.' + pos, t('device.notSent', 'Not sent'), t('device.notSentHint', 'in the catalog, not set to send: nothing reaches the cloud'), list.length);
  el.classList.add('ts-notsent');
  list.forEach(function (o) {
    var entry = state.names[o.measure.defaultName] || {};
    var label = entry.label ? t.channel(o.measure.defaultName, entry.label) : o.measure.defaultName;
    var row = el.appendChild(crow(true));
    row.dataset.notsent = o.sourceKey;
    row.querySelector('.ts-row-label').textContent = label;
    nameSub(row, o.sourceKey, 'ts-mono');
    var every = row.querySelector('.ts-mc-every');
    if (state.writable) {
      var iv = intervalInputs(900);
      every.appendChild(iv.el);
      var b = every.appendChild(h('<button type="button" class="ts-btn sm" data-a="subscribe"></button>'));
      b.textContent = t('device.subscribe', 'Send');
      b.addEventListener('click', function () {
        var v = iv.seconds();
        if (!(v >= 1 && v <= 65535 && Math.floor(v) === v)) { ui.toast(t('device.intervalInvalid', 'An interval is a whole number of seconds, 1 to 65535'), 'error'); return; }
        state.adds.push({ sourceKey: o.sourceKey, target: o.target, interval: v, label: label });
        render();
      });
    } else {
      every.appendChild(h('<span class="ts-wire-diag"></span>')).textContent = t('device.notSentShort', 'not sent');
    }
  });
  return el;
}

/** Readings the device no longer sends, with their last value and the stations still storing them;
 * a writer deletes them one by one or all at once. `kind` is `earlier`, what an earlier peripheral
 * at the position left behind, or `stopped`, sources the device's subscriptions report no longer
 * carries (DEVICE_VIEW.md §2 *Sources*). Open at first when `open`. */
function leftoverPart(kind, pos, list, node, open) {
  var last = newestTs(list), earlier = kind === 'earlier';
  var el = confPart(kind + '.' + pos, earlier ? t('device.earlierReadings', 'Earlier readings at this position') : t('device.noLongerSent', 'No longer sent'),
    last ? t('device.lastReading', 'last reading {when}', { when: ui.when(last) }) : '', list.length, open);
  el.dataset[kind] = list.length;
  function keysOf(sources) {
    var keys = [];
    sources.forEach(function (s) { [s.sourceKey, s.sourceKey + '.status'].forEach(function (k) { if (state.latest[k]) { keys.push(k); } }); });
    // A DRYC status goes with the readings unpacked from it.
    if (sources.some(function (s) { return s.kind === 'drycStatus'; })) {
      Object.keys(state.latest).forEach(function (k) { if (k.indexOf('p' + pos + '.') === 0 && M.DRYC_FIELD.test(k)) { keys.push(k); } });
    }
    return keys;
  }
  if (state.writable) {
    var del = el.querySelector('.ts-mgroup-acts').appendChild(h('<button type="button" class="ts-btn danger sm" data-a="delete-' + kind + '"></button>'));
    del.textContent = t('device.deleteData', 'Delete data');
    del.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      deleteData(earlier ? t('device.earlierPeripheral', 'earlier peripheral at position {pos}', { pos: pos })
        : t('device.noLongerSentAt', 'measurements no longer sent at position {pos}', { pos: pos }), keysOf(list));
    });
  }
  list.forEach(function (s) {
    var v = state.latest[s.sourceKey], row = el.appendChild(crow(true)), label = sourceLabel(s, node);
    row.dataset.source = s.sourceKey;
    row.dataset.state = kind;
    row.querySelector('.ts-row-label').textContent = label;
    nameSub(row, s.sourceKey, 'ts-mono');
    var every = row.querySelector('.ts-mc-every');
    every.appendChild(h('<span class="ts-wire-diag"></span>')).textContent = v ? fmtValue(v.value) + (unitOf(s) ? ' ' + unitOf(s) : '') + ' · ' + t.ago(v.ts) : '—';
    if (state.writable) {
      var one = every.appendChild(h('<button type="button" class="ts-btn danger sm" data-a="delete-one"></button>'));
      one.textContent = t('common.delete', 'Delete');
      one.title = t('device.deleteData', 'Delete data');
      one.addEventListener('click', function () { deleteData(label, keysOf([s])); });
    }
    storeCell(row, s.sourceKey, false, true);
  });
  return el;
}

/** Every key a position stored on the device: its readings, their status and a DRYC's unpacked fields. */
function positionKeys(pos) {
  return Object.keys(state.latest).filter(function (k) { return k.indexOf('p' + pos + '.') === 0; });
}

/** Removed positions whose readings have all gone silent, folded out of the way; a writer deletes their data one by one or all at once. */
function formerGroup(list, srcs) {
  var g = group('former');
  g.el.dataset.former = list.length;
  g.num(null);
  g.name(t('device.formerPositions', 'Former positions'));
  var gone = [].concat.apply([], list.map(positionKeys));
  if (state.writable && list.length > 1 && gone.length) {
    g.act('<button type="button" class="ts-btn danger" data-a="delete-former">' + esc(t('device.deleteData', 'Delete data')) + '</button>', function () {
      deleteData(t('device.formerPositionsAt', 'former positions {list}', { list: list.join(', ') }), gone);
    });
  }
  var since = Math.max.apply(null, list.map(function (pos) { return newestTs(srcs.filter(function (s) { return s.position === pos; })); }));
  g.mono(t('device.formerSince', 'Removed from the bus, silent since {when}', { when: ui.when(since) }));
  g.sum(String(list.length));
  list.forEach(function (pos) {
    var inner = positionGroup(pos, null, srcs, true);
    inner.close();
    inner.el.classList.add('inner');
    g.el.appendChild(inner.el);
    inner.rows.forEach(function (r) { r.attention = false; g.rows.push(r); });
  });
  return g;
}

/** A LOGR4 DRYC's inputs, outputs and supply voltage, unpacked from its status (ATTRIBUTES.md §1). */
function drycFields(pos) {
  var prefix = 'p' + pos + '.';
  return Object.keys(state.latest).filter(function (k) {
    return k.indexOf(prefix) === 0 && M.DRYC_FIELD.test(k) && !/(RuleCount|RulesSynced|RulesCrc16)$/.test(k);
  }).sort(function (a, b) { return labelOf(a).localeCompare(labelOf(b)); });
}

/** Where a LOGR4 DRYC's rules stand against the last rules set sent to its position (DRYC.md §5); null when nothing compares. */
function drycSync(pos) {
  function isRules(c) { return c.op === 'PERIPHERAL_OP' && !!c.dryc_rules && (c.target || {}).position === pos; }
  var queued = pending();
  if (queued && queued.commands.some(isRules)) {
    return queued.unanswered ? { cls: 'warn', text: t('dryc.notConfirmed', 'Not confirmed') } : { cls: 'warn', text: t('dryc.waiting', 'Waiting for the device') };
  }
  var last = parseValue(state.server['cmd.lastResult']), sent = null;
  ((last && last.commands) || []).forEach(function (c, i) {
    if (isRules(c)) { sent = { cmd: c, ok: ((last.results || [])[i] || {}).status === 'OK' }; }
  });
  if (sent && !sent.ok) { return { cls: 'fault', text: t('dryc.refused', 'Refused') }; }
  var crc = Number((state.latest['p' + pos + '.drycRulesCrc16'] || {}).value) || 0;
  if (!crc) { return { cls: '', text: t('dryc.noStatus', 'No status yet') }; }
  if (!sent || sent.cmd.rules_crc16 === undefined) { return null; }
  return sent.cmd.rules_crc16 === crc ? { cls: 'ok', text: t('dryc.onDevice', 'On the device') } : { cls: 'warn', text: t('dryc.sendNeeded', 'Send needed') };
}

/** A DRYC in one row: which inputs and relays are on, its supply and, on a LOGR4, where its rules stand.
 * Its inputs, relays and rules are set up in its own view (DRYC.md), which the row opens; returns
 * whether its rules need a look. `prefix` is `p<POS>.` on a LOGR4, `dryc.` on a LOGR2, whose rules are the station's. */
function drycCells(row, prefix, pos) {
  var lat = state.latest, ts = 0;
  function on(name, n) {
    var out = [];
    for (var i = 1; i <= n; i++) {
      var v = lat[prefix + name + i];
      if (!v) { continue; }
      ts = Math.max(ts, v.ts);
      if (truthyFlag(v.value) || v.value === '1') { out.push(i); }
    }
    return out.length ? out.join(', ') : t('common.none', 'none');
  }
  var parts = [t('device.drycRelaysOn', 'Relays on: {list}', { list: on('drycOutput', 2) })];
  var volt = lat[prefix + 'drycVoltage'];
  if (volt) {
    ts = Math.max(ts, volt.ts);
    parts.push(t('device.drycSupply', 'supply {v} V', { v: fmtValue(volt.value) }));
  }
  var cell = row.querySelector('.ts-mc-latest');
  cell.innerHTML = '';
  // The inputs as circles with the status's age (DRYC.md §8), named as the station holding the rules names them.
  var glance = window.TerrySenseDrycGlance(lat, prefix, (drycRules() || {}).inputs);
  if (glance) { cell.appendChild(h('<div class="ts-dryc-line"></div>')).appendChild(glance); ts = 0; }
  cell.appendChild(h('<div class="ts-dryc-line"></div>')).textContent = parts.join(' · ');
  var sync = null;
  if (pos !== null) {
    var count = lat[prefix + 'drycRuleCount'];
    var rules = cell.appendChild(h('<div class="ts-dryc-rules" data-dryc-rules="1"><span></span></div>'));
    rules.firstChild.textContent = !count ? '' : Number(count.value) === 1 ? t('dryc.ruleCountOne', '1 rule')
      : t('dryc.ruleCountMany', '{n} rules', { n: fmtValue(count.value) });
    sync = drycSync(pos);
    if (sync) {
      var chip = rules.appendChild(h('<span class="ts-chip"></span>'));
      if (sync.cls) { chip.classList.add(sync.cls); }
      chip.dataset.drycSync = sync.cls || 'unknown';
      chip.textContent = sync.text;
    }
  }
  if (ts) { cell.appendChild(h('<div class="ts-row-meta"></div>')).textContent = t.ago(ts); }
  drycLink(cell.appendChild(h('<div class="ts-dryc-link"></div>')));
  return !!sync && sync.cls === 'fault';
}

/** The rule set of the station holding this device's DRYC rules, or null (DRYC.md §1). */
function drycRules() {
  return state.bindings.map(function (b) { return parseJson(b.attrs['dryc.rules']); }).filter(Boolean)[0] || null;
}

/** The DRYC's row when no subscribed status carries it: a LOGR2's, or a LOGR4's before its SUBSCRIPTIONS report. */
function drycRow(prefix, pos, bus) {
  var row = mrow(bus);
  row.dataset.dryc = '1';
  row.querySelector('.ts-row-label').textContent = t('device.drycState', 'Inputs, relays and supply');
  return { el: row, attention: drycCells(row, prefix, pos), unstored: false };
}

/** Opens the Dry contact interface view of the station holding the rules (DRYC.md §1), or says a station is needed first. */
function drycLink(container) {
  var st = state.bindings.slice().sort(function (a, b) {
    return !!parseJson(b.attrs['dryc.rules']) - !!parseJson(a.attrs['dryc.rules']);
  })[0];
  if (!st) {
    container.appendChild(h('<span class="ts-wire-diag"></span>')).textContent = t('device.drycNoStation', 'Inputs, relays and rules are set up on a station: connect this device to one first.');
    return;
  }
  if (!opts.projectDashboardId) { return; }
  var b = container.appendChild(h('<button type="button" class="ts-btn sm" data-a="relays"><span></span>' + ICON.chev + '</button>'));
  b.firstChild.textContent = t('device.drycView', 'Digital I/O module view');
  b.title = st.station.name;
  b.addEventListener('click', function () { tb.openDashboard(opts.projectDashboardId, 'dryc', st.station); });
}

// -- LOGR2 and other devices ---------------------------------------------------------------

/** A LOGR2's own readings first, then its sensors by key prefix at addresses 1, 2; any other device's readings in one group. */
function partGroups() {
  var fam = family(), keys = readings(), out = [], address = 0;
  var parts = fam === 'logr2' ? logr2Parts(keys) : [{ id: 'device', label: state.device.type || t('common.device', 'Device'), keys: keys }];
  var logger = parts[0];
  if (fam === 'logr2' && logger.id === 'logr' && logger.keys.length) { out.push(partGroup(logger, true)); }
  parts.forEach(function (part) {
    if (part.keys.length && part.id !== 'logr') { out.push(partGroup(part, fam === 'logr2', ++address)); }
  });
  return out;
}

function partGroup(part, logr2, address) {
  var logger = part.id === 'logr';
  var g = group('part.' + part.id);
  g.el.dataset.part = part.id;
  g.num(logger ? 0 : logr2 ? address : null);
  g.name(part.label || t('mapping.logrItself', 'LOGR itself'));
  g.mono(logr2 && !logger ? part.id + '.' : '');
  if (LOGR2_SENSORS[part.id] && state.writable) {
    g.act('<button type="button" class="ts-btn danger" data-a="delete-data">' + esc(t('device.deleteData', 'Delete data')) + '</button>', function () { deleteData(part.label, sensorKeys(part)); });
  }
  if (part.id === 'dryc') { g.add(drycRow('dryc.', null, false)); return g; }
  part.keys.slice().sort(function (a, b) { return labelOf(a).localeCompare(labelOf(b)); })
    .forEach(function (key) { g.add(readingRow(key, logger, false)); });
  var n = g.rows.length;
  g.sum(logger ? (n === 1 ? t('device.diagnosticOne', '1 diagnostic') : t('device.diagnosticMany', '{n} diagnostics', { n: n }))
    : n === 1 ? t('device.readingOne', '1 reading') : t('device.readingMany', '{n} readings', { n: n }));
  return g;
}

// -- subscriptions: the edit mode (CA-4, TC-8/9) ------------------------------------------------

/** Whether the device's SUBSCRIPTIONS report names the source; a source known from its readings alone has none to switch. */
function subscribed(s) { return s.enabled !== undefined || s.interval !== undefined; }

var UNITS = [{ s: 1, label: 's' }, { s: 60, label: 'min' }, { s: 3600, label: 'h' }];

/** The unit an interval reads best in: the largest that divides it. */
function unitFor(sec) {
  return UNITS.slice().reverse().filter(function (u) { return sec >= u.s && sec % u.s === 0; })[0] || UNITS[0];
}

// Source intervals against the uplink interval (measurement/home.md, measurement and uplink intervals).
var MAX_INTERVAL_S = 65535;
function uplinkS() { return Number(state.client['status.baseIntervalSeconds']) || 0; }
/** n when `sec` is n whole uplink intervals, else 0. */
function uplinksIn(sec, uplink) { sec = Number(sec); return uplink > 0 && sec > 0 && sec % uplink === 0 ? sec / uplink : 0; }
function everyUplinks(n) { return n === 1 ? t('device.everyUplink', 'every uplink') : t('device.everyNUplinks', 'every {n} uplinks', { n: n }); }
/** A source interval: every n uplinks where it is a multiple of the uplink interval, else its duration. */
function fmtInterval(sec) { var n = uplinksIn(sec, uplinkS()); return n ? everyUplinks(n) : fmtDuration(sec); }

/** What an uplink interval change from `from` to `to` does to the subscriptions the device reports:
 * the multiples of `from`, each resent as n × `to` or the largest multiple within 65535 s, and the
 * warnings of the intervals rule on the intervals after the change, multiples kept or not. */
function uplinkPlan(from, to, keep) {
  var multiples = [], warnings = [];
  sources().forEach(function (s) {
    var iv = Number(s.interval);
    if (!subscribed(s) || s.enabled === false || s.enabled === 'false' || !(iv > 0)) { return; }
    var sec = iv, n = uplinksIn(iv, from);
    if (n) {
      var largest = Math.floor(MAX_INTERVAL_S / to);
      if (n * to > MAX_INTERVAL_S) {
        warnings.push(largest ? t('device.multipleTooLong', '{source}: every {n} uplinks would be over 65535 s; every {m} uplinks instead, or keep the seconds.', { source: s.sourceKey, n: n, m: largest })
          : t('device.multipleKeepsSeconds', '{source}: every {n} uplinks would be over 65535 s; it keeps every {d}.', { source: s.sourceKey, n: n, d: fmtDuration(iv) }));
      }
      if (largest) {
        var m = { source: s, n: Math.min(n, largest), seconds: Math.min(n, largest) * to };
        multiples.push(m);
        if (keep) { sec = m.seconds; }
      }
    }
    if (sec % to && to % sec) {
      warnings.push(t('device.intervalDrifts', '{source}: every {d} is neither a multiple nor a divisor of the uplink interval; its readings drift against the uplinks.', { source: s.sourceKey, d: fmtDuration(sec) }));
    }
    if (sec < to) {
      warnings.push(t('device.intervalSeveral', '{source}: several readings per uplink, each adding to the air time of every uplink.', { source: s.sourceKey }));
    }
  });
  return { multiples: multiples, warnings: warnings };
}

/** The queued changes that target this source. */
function queuedFor(s) {
  var queued = pending();
  return (queued ? queued.commands : []).filter(function (c) {
    var t = c.target || {};
    return t.mode === 'SOURCE' && t.position === s.position && t.kind === wireKind(s.kind) &&
      (t.group || 0) === s.group && (t.index === undefined || t.index === s.index);
  });
}

/** Read: the interval and whether the subscription is on, as the device last reported, and a queued change.
 * In the edit mode: the switch, the interval and remove, or subscribe, each joining the draft. */
function everyCell(cell, s, row, node) {
  if (state.writable) { editCell(cell, s, row, node); } else { everyText(cell, s); }
  var queued = queuedFor(s);
  if (queued.length) {
    var chip = cell.appendChild(h('<div class="ts-mqueued" data-queued="1"></div>'));
    chip.textContent = t('device.changeQueued', 'change queued');
    chip.title = t('device.afterNextUplink', '{commands}, after the next uplink', { commands: queued.map(commandText).join(' · ') });
  }
}

function everyText(cell, s) {
  if (!subscribed(s)) {
    cell.appendChild(h('<span class="ts-chip" data-subscribed="false"></span>')).textContent = t('device.notSubscribed', 'not sent');
  } else {
    var on = s.enabled === undefined || truthyFlag(s.enabled);
    var every = cell.appendChild(h('<span class="ts-tsrc-every"></span>'));
    if (s.enabled !== undefined) { every.dataset.enabled = String(on); }
    if (s.interval) { every.dataset.interval = s.interval; }
    every.textContent = !on ? t('common.valueOff', 'off') : s.interval ? fmtInterval(s.interval) : '—';
    if (on && uplinksIn(s.interval, uplinkS())) { every.title = fmtDuration(s.interval); }
    if (s.trigger && s.trigger !== 'none') {
      var rule = cell.appendChild(h('<div class="ts-mrule"></div>'));
      rule.dataset.trigger = s.trigger;
      rule.textContent = t('device.reportsAtOnce', 'reports at once {rule}', { rule: ruleText(s.trigger, s.minInterval, s.level, unitOf(s)) });
    }
  }
}

/** A source interval: a number and a unit, *uplinks* among them once the uplink interval is known,
 * picked where the interval is a multiple of it. */
function intervalInputs(seconds) {
  var box = h('<span class="ts-tsrc-every"><input class="ts-input num sm ts-src-int" type="number" min="1" step="1" inputmode="numeric"><select class="ts-select sm ts-src-unit"></select></span>');
  var input = box.querySelector('input'), unit = box.querySelector('select'), uplink = uplinkS();
  UNITS.forEach(function (u) { var o = document.createElement('option'); o.value = u.s; o.textContent = u.label; unit.appendChild(o); });
  if (uplink) {
    var o = unit.appendChild(document.createElement('option'));
    o.value = 'uplinks';
    o.textContent = t('device.unitUplinks', 'uplinks');
  }
  function step() { return unit.value === 'uplinks' ? uplink : Number(unit.value); }
  function bound() { if (unit.value === 'uplinks') { input.max = Math.floor(MAX_INTERVAL_S / uplink); } else { input.removeAttribute('max'); } }
  var n = uplinksIn(seconds, uplink);
  if (n) {
    unit.value = 'uplinks';
    input.value = n;
  } else if (seconds) {
    var u = unitFor(seconds);
    unit.value = u.s;
    input.value = seconds / u.s;
  } else {
    unit.value = 60;
    input.placeholder = '?';
  }
  bound();
  unit.addEventListener('change', bound);
  return { el: box, seconds: function () { return input.value === '' ? null : Number(input.value) * step(); } };
}

function editCell(cell, s, row, node) {
  var d = state.draft[s.sourceKey] || {};
  var current = Number(s.interval) || 0;
  if (!subscribed(s)) {
    var sub = cell.appendChild(h('<label class="ts-switch ts-src-sub"><input type="checkbox"><span></span></label>'));
    sub.querySelector('span').textContent = t('device.subscribe', 'Send');
    var iv = intervalInputs(d.create ? d.create : 900);
    cell.appendChild(iv.el);
    var box = sub.querySelector('input');
    box.checked = !!d.create;
    var sync = function () {
      if (box.checked) { state.draft[s.sourceKey] = { create: iv.seconds() }; } else { delete state.draft[s.sourceKey]; }
      draftChanged(row, s);
    };
    box.addEventListener('change', sync);
    iv.el.addEventListener('input', function () { if (box.checked) { sync(); } });
    iv.el.addEventListener('change', function () { if (box.checked) { sync(); } });
    draftChanged(row, s, true);
    return;
  }
  var on = !(s.enabled === false || s.enabled === 'false');
  var toggle = cell.appendChild(h('<label class="ts-switch ts-src-toggle"><input type="checkbox"><span></span></label>'));
  toggle.dataset.enabled = String(on);
  var check = toggle.querySelector('input');
  check.checked = d.enabled !== undefined ? d.enabled : on;
  toggle.querySelector('span').textContent = t('common.valueOn', 'on');
  var ivs = intervalInputs(d.interval || current);
  cell.appendChild(ivs.el);
  var remove = cell.appendChild(h('<button type="button" class="ts-icon-btn" data-a="remove">' + ICON.close + '</button>'));
  remove.title = t('device.removeSubscription', 'Stop sending');
  var rule = triggersOf(s).length ? ruleEditor(s, node, d.rule) : null;
  if (rule) { cell.appendChild(advanced(s, rule.el, !!d.rule)); }
  function update() {
    var next = {};
    if (remove.classList.contains('on')) { next.remove = true; }
    else {
      if (check.checked !== on) { next.enabled = check.checked; }
      var sec = ivs.seconds();
      if (sec !== null && sec !== current) { next.interval = sec; }
      var r = rule && rule.changed();
      if (r) { next.rule = r; }
    }
    if (Object.keys(next).length) { state.draft[s.sourceKey] = next; } else { delete state.draft[s.sourceKey]; }
    draftChanged(row, s);
  }
  if (d.remove) { remove.classList.add('on'); }
  check.addEventListener('change', update);
  ivs.el.addEventListener('input', update);
  ivs.el.addEventListener('change', update);
  remove.addEventListener('click', function () { remove.classList.toggle('on'); update(); });
  if (rule) { rule.onChange(update); }
  draftChanged(row, s, true);
}

/** The reporting rule's editor in a closed *Advanced* part, its header naming the rule in effect (APP_CHANGES.md §15). */
function advanced(s, editor, drafted) {
  var el = h('<details class="ts-madv"><summary><span class="ts-pos-chev">' + ICON.chev + '</span><span class="ts-madv-title"></span></summary></details>');
  var active = s.trigger && s.trigger !== 'none';
  el.dataset.rule = active ? s.trigger : 'none';
  el.querySelector('.ts-madv-title').textContent = active
    ? t('device.advancedRule', 'Advanced · reports at once {rule}', { rule: ruleText(s.trigger, s.minInterval, s.level, unitOf(s)) })
    : t('device.advanced', 'Advanced');
  memo.bind(el, placeOf('adv.' + s.sourceKey), drafted);
  el.appendChild(editor);
  return el;
}

/** The triggers a rule on this source may use: its kind's, from the catalog defaults. Empty for a
 * device that reports no rule (firmware before wire v3 answers SET_TRIGGER with ERR_UNKNOWN_OP). */
function triggersOf(s) {
  if (s.trigger === undefined) { return []; }
  return ((resolver.kindSpec(s.kind, state.kinds) || {}).triggers) || [];
}

var LEVEL_TRIGGERS = ['above', 'below'];

/** The reporting rule beside the interval: a trigger from the kind's, a level and re-arm margin for
 * above / below, and the minimum gap between two prompt uplinks; a change joins the draft as SET_TRIGGER. */
function ruleEditor(s, node, drafted) {
  var el = h('<div class="ts-mrule ts-src-rule"><span class="ts-row-meta"></span><select class="ts-select sm ts-src-trig"></select>' +
    '<span class="ts-src-level" hidden><input class="ts-input num sm ts-src-lvl" type="number" step="any">' +
    ' <span class="ts-row-meta ts-src-rearm"></span> <input class="ts-input num sm ts-src-hys" type="number" min="0" step="any"><span class="ts-src-unit-l"></span></span>' +
    '<span class="ts-src-gap"><span class="ts-row-meta"></span> <input class="ts-input num sm ts-src-min" type="number" min="0" max="65535" step="1"> s</span></div>');
  el.firstChild.textContent = t('device.reportAtOnce', 'Report at once');
  el.querySelector('.ts-src-rearm').textContent = t('device.rearmBy', 're-arm by');
  el.querySelector('.ts-src-unit-l').textContent = unitOf(s) ? ' ' + unitOf(s) : '';
  el.querySelector('.ts-src-gap .ts-row-meta').textContent = t('device.atMostEvery', 'at most every');
  var sel = el.querySelector('.ts-src-trig'), lvl = el.querySelector('.ts-src-lvl'), hys = el.querySelector('.ts-src-hys');
  var gap = el.querySelector('.ts-src-min'), levelEl = el.querySelector('.ts-src-level'), gapEl = el.querySelector('.ts-src-gap');
  var label = {
    none: t('device.triggerNone', 'never, on its schedule only'),
    rise: t('device.ruleRise', 'when it turns on'),
    fall: t('device.ruleFall', 'when it turns off'),
    change: t('device.ruleChange', 'when it changes'),
    above: t('device.triggerAbove', 'when it rises above'),
    below: t('device.triggerBelow', 'when it falls below')
  };
  ['none'].concat(triggersOf(s)).forEach(function (tr) {
    var o = document.createElement('option'); o.value = tr; o.textContent = label[tr] || tr; sel.appendChild(o);
  });
  var current = { trigger: s.trigger, minInterval: Number(s.minInterval) || 0, level: s.level, hysteresis: s.hysteresis };
  if (triggersOf(s).indexOf(current.trigger) < 0) { current.trigger = 'none'; }
  el.dataset.trigger = current.trigger;
  // A new rule starts from the catalog default of the measure, when it has one.
  var dflt = ((measureOf(s, node) || {}).defaultRule) || {};
  function fill() {
    var tr = sel.value;
    var from = tr === current.trigger ? current
      : dflt.trigger === tr ? { minInterval: dflt.minInterval_s, level: dflt.level, hysteresis: dflt.hysteresis } : {};
    gap.value = from.minInterval !== undefined ? from.minInterval : 0;
    lvl.value = from.level !== undefined && from.level !== null ? from.level : '';
    hys.value = from.hysteresis !== undefined && from.hysteresis !== null ? from.hysteresis : 0;
  }
  function show() {
    levelEl.hidden = LEVEL_TRIGGERS.indexOf(sel.value) < 0;
    gapEl.hidden = sel.value === 'none';
  }
  sel.value = drafted ? drafted.trigger : current.trigger;
  fill();
  if (drafted) {
    if (drafted.min_interval_s !== undefined) { gap.value = drafted.min_interval_s; }
    if (drafted.level !== undefined) { lvl.value = drafted.level; }
    if (drafted.hysteresis !== undefined) { hys.value = drafted.hysteresis; }
  }
  show();
  return {
    el: el,
    /** The SET_TRIGGER fields when they differ from the device's rule, else null; checked when the draft is sent. */
    changed: function () {
      var tr = sel.value;
      var same = tr === current.trigger && (tr === 'none' || (Number(gap.value) === current.minInterval &&
        (LEVEL_TRIGGERS.indexOf(tr) < 0 || (Number(lvl.value) === Number(current.level) && Number(hys.value) === Number(current.hysteresis)))));
      if (same) { return null; }
      var r = { trigger: tr };
      if (tr !== 'none') { r.min_interval_s = gap.value === '' ? NaN : Number(gap.value); }
      if (LEVEL_TRIGGERS.indexOf(tr) >= 0) { r.level = lvl.value === '' ? NaN : Number(lvl.value); r.hysteresis = Number(hys.value); }
      return r;
    },
    onChange: function (fn) {
      sel.addEventListener('change', function () { fill(); show(); fn(); });
      [lvl, hys, gap].forEach(function (i) { i.addEventListener('input', fn); });
    }
  };
}

/** Why a SET_TRIGGER of the draft cannot go, or null. */
function ruleInvalid(c) {
  if (c.trigger === 'none') { return null; }
  var g = c.min_interval_s;
  if (!(g >= 0 && g <= 65535 && Math.floor(g) === g)) { return t('device.gapInvalid', 'The minimum gap is a whole number of seconds, 0 to 65535'); }
  if (LEVEL_TRIGGERS.indexOf(c.trigger) >= 0) {
    if (!isFinite(c.level)) { return t('device.levelInvalid', 'Give the level as a number'); }
    if (!(c.hysteresis >= 0)) { return t('device.rearmInvalid', 'The re-arm margin is a number, 0 or more'); }
  }
  return null;
}

/** Mark the row by its draft and recount the edit bar. */
function draftChanged(row, s, quiet) {
  var d = state.draft[s.sourceKey];
  row.classList.toggle('changed', !!d);
  row.classList.toggle('removing', !!(d && d.remove));
  var note = row.querySelector('.ts-mchange');
  if (!note) { note = row.querySelector('.ts-mc-name').appendChild(h('<div class="ts-mchange"></div>')); }
  note.textContent = d ? draftCommands([s]).map(commandText).join(' · ') : '';
  if (!quiet) { updateEditBar(); }
}

/** The commands the draft of these sources sends, and every measurement added. */
function draftCommands(srcs) {
  var out = [];
  srcs.forEach(function (s) {
    var d = state.draft[s.sourceKey];
    if (!d) { return; }
    var target = sourceTarget(s);
    if (d.remove) { out.push({ op: 'DELETE_SUBSCRIPTION', target: target }); return; }
    if (d.create !== undefined) { out.push({ op: 'CREATE_SUBSCRIPTION', target: target, interval_s: d.create }); return; }
    if (d.enabled !== undefined) { out.push({ op: 'SET_ENABLED', target: target, enabled: d.enabled }); }
    if (d.interval !== undefined) { out.push({ op: 'SET_INTERVAL', target: target, interval_s: d.interval }); }
    if (d.rule) { out.push(Object.assign({ op: 'SET_TRIGGER', target: target }, d.rule)); }
  });
  return out;
}

function allDraftCommands() {
  return draftCommands(sources()).concat(state.adds.map(function (a) { return { op: 'CREATE_SUBSCRIPTION', target: a.target, interval_s: a.interval }; }));
}

/** The rows of measurements added to the draft at a position. */
function addedRows(pos) {
  return state.adds.filter(function (a) { return a.target.position === pos; }).map(function (a) {
    var row = crow(true);
    row.classList.add('changed');
    row.dataset.add = a.sourceKey;
    row.querySelector('.ts-row-label').textContent = a.label;
    nameSub(row, a.sourceKey, 'ts-mono');
    row.querySelector('.ts-mc-name').appendChild(h('<div class="ts-mchange"></div>')).textContent =
      commandText({ op: 'CREATE_SUBSCRIPTION', target: a.target, interval_s: a.interval });
    row.querySelector('.ts-mc-every').appendChild(h('<span class="ts-tsrc-every"></span>')).textContent = fmtInterval(a.interval);
    var undo = row.querySelector('.ts-mc-every').appendChild(h('<button type="button" class="ts-icon-btn" data-a="undo-add">' + ICON.close + '</button>'));
    undo.title = t('device.undoAdd', 'Leave it out');
    undo.addEventListener('click', function () { state.adds = state.adds.filter(function (x) { return x !== a; }); render(); });
    return { conf: row };
  });
}

var editBarEl = null;

/** At the foot of the measurements, once a change is drafted: how many, Cancel, and one send for all of them. */
function editBar() {
  editBarEl = h('<div class="ts-dev-editbar"><b class="ts-editbar-count"></b><span class="ts-editbar-list ts-grow"></span>' +
    '<button type="button" class="ts-btn" data-a="cancel-edits"></button><button type="button" class="ts-btn primary" data-a="send-edits"></button></div>');
  editBarEl.querySelector('[data-a=cancel-edits]').textContent = t('common.cancel', 'Cancel');
  editBarEl.querySelector('[data-a=send-edits]').textContent = t('device.reviewSend', 'Review and send');
  editBarEl.querySelector('[data-a=cancel-edits]').addEventListener('click', function () {
    state.draft = {}; state.adds = []; render();
  });
  editBarEl.querySelector('[data-a=send-edits]').addEventListener('click', sendEdits);
  updateEditBar();
  return editBarEl;
}

function updateEditBar() {
  if (!editBarEl) { return; }
  var cmds = allDraftCommands();
  editBarEl.querySelector('.ts-editbar-count').textContent = cmds.length === 1 ? t('device.changeOne', '1 change') : t('device.changeMany', '{n} changes', { n: cmds.length });
  editBarEl.querySelector('.ts-editbar-list').textContent = cmds.length ? cmds.map(commandText).join(' · ') : t('device.editHint', 'Switch, set or stop sending measurements above; the changes go out together.');
  editBarEl.querySelector('[data-a=send-edits]').disabled = !cmds.length;
  editBarEl.hidden = !cmds.length;
}

function sendEdits() {
  var cmds = allDraftCommands();
  var bad = cmds.filter(function (c) {
    var v = c.interval_s;
    return v !== undefined && !(v >= 1 && v <= 65535 && Math.floor(v) === v);
  });
  if (bad.length) { ui.toast(t('device.intervalInvalid', 'An interval is a whole number of seconds, 1 to 65535'), 'error'); return; }
  var why = cmds.map(function (c) { return c.op === 'SET_TRIGGER' ? ruleInvalid(c) : null; }).filter(Boolean)[0];
  if (why) { ui.toast(why, 'error'); return; }
  var shorter = cmds.some(function (c) {
    if (c.op !== 'SET_INTERVAL') { return false; }
    var s = sources().filter(function (x) { return x.sourceKey === sourceKeyOf(c.target); })[0];
    return s && c.interval_s < Number(s.interval);
  });
  send(cmds, shorter ? t('device.shorterCosts', 'A shorter interval costs battery.') : null).then(function (sent) {
    if (!sent) { return; }
    state.draft = {}; state.adds = [];
    render();
  });
}

function sourceKeyOf(tg) { return 'p' + tg.position + '.' + camel(tg.kind) + (tg.group ? '.g' + tg.group : '') + (tg.index ? '.i' + tg.index : ''); }

// -- rail -------------------------------------------------------------------------------

function railCard(id, title, tip) {
  var el = h('<section class="ts-dev-card"><div class="ts-dev-card-head"><h3 class="ts-dev-h"></h3>' + (tip ? ' ' + info(tip) : '') +
    '<span class="ts-spacer"></span></div><div class="ts-dev-card-body"></div></section>');
  el.setAttribute('data-section', id);
  el.setAttribute('data-title', title);
  el.querySelector('.ts-dev-h').textContent = title;
  return { el: el, head: el.querySelector('.ts-dev-card-head'), body: el.querySelector('.ts-dev-card-body') };
}

/** The Stations the device feeds (TC-2, CA-1): how many channels it gives each, and their editors. */
function stationsCard() {
  var n = state.bindings.length;
  var card = railCard('stations', t('common.stations', 'Stations'), 'wiring');
  card.el.querySelector('.ts-dev-h').textContent = n === 1 ? t('device.feedsOne', 'Feeds 1 station') : n ? t('device.feedsMany', 'Feeds {n} stations', { n: n }) : t('common.stations', 'Stations');
  if (state.writable) {
    card.head.appendChild(h('<button type="button" class="ts-btn sm" data-a="connect">' + ICON.plus + esc(t('device.connect', 'Connect')) + '</button>'))
      .addEventListener('click', function () { bindDrawer(null); });
  }
  if (!n) {
    card.body.appendChild(h('<div class="ts-empty"><span class="ts-chip warn">' + esc(t('common.onNoStation', 'on no station')) + '</span> ' +
      esc(t('device.storedOnDeviceOnly', 'Its readings are stored on the device only.')) + '</div>'));
    return card.el;
  }
  state.bindings.forEach(function (b) {
    var mine = Object.keys(mineOf(b.entries)).length, others = othersOf(b.entries).length;
    var el = card.body.appendChild(h('<div class="ts-dev-station"><div class="ts-dev-station-name"><b></b></div><div class="ts-row-meta"></div><div class="ts-dev-station-acts"></div></div>'));
    el.dataset.station = b.station.name;
    el.querySelector('b').textContent = b.station.name;
    var sv = tb.serviceOf(b.attrs);
    if (sv.retired || sv.silencedUntil) {
      el.querySelector('.ts-dev-station-name').appendChild(sv.retired ? ui.stateChip('retired') : ui.stateChip('silenced', sv.silencedUntil));
    }
    el.querySelector('.ts-row-meta').textContent = (mine === 1 ? t('device.channelsMineOne', '1 channel from this device') : mine ? t('device.channelsMineMany', '{n} channels from this device', { n: mine })
      : t('device.noChannel', 'no channel from this device')) + (others ? ' · ' + (others === 1 ? t('device.channelsOthersOne', '1 from another device') : t('device.channelsOthersMany', '{n} from other devices', { n: others })) : '');
    var acts = el.querySelector('.ts-dev-station-acts');
    function act(html, fn) { acts.appendChild(h(html)).addEventListener('click', fn); }
    if (state.writable && b.writable) {
      act('<button type="button" class="ts-btn sm" data-a="edit">' + ICON.edit + esc(t('common.channels', 'Channels')) + '</button>', function () { bindDrawer(b); });
    }
    if (opts.projectDashboardId) {
      act('<button type="button" class="ts-btn sm" data-a="open">' + esc(t('common.installation', 'Installation')) + ICON.chev + '</button>', function () {
        tb.openDashboard(opts.projectDashboardId, 'station', b.station);
      });
    }
    if (state.writable && b.writable) {
      act('<button type="button" class="ts-icon-btn" data-a="disconnect" title="' + esc(t('device.disconnect', 'Disconnect')) + '">' + ICON.close + '</button>', function () { disconnect(b); });
    }
  });
  return card.el;
}

/** The device-wide *Configure*, closed: the queued set and the last answer for everyone who may see them, the
 * device-wide commands for a writer. Its header names the queued set and a failed answer. */
function commandsCard() {
  var queued = pending();
  var last = parseValue(state.server['cmd.lastResult']);
  if (!state.writable && !queued && !last) { return null; }
  var title = state.writable ? t('device.configureDevice', 'Configure the device') : t('device.commands', 'Commands');
  var el = h('<details class="ts-dev-card ts-dev-conf"><summary class="ts-dev-card-head"><span class="ts-pos-chev">' + ICON.chev + '</span>' +
    '<h3 class="ts-dev-h"></h3> ' + info('commands') + '<span class="ts-dev-conf-flags"></span></summary><div class="ts-dev-card-body"></div></details>');
  el.setAttribute('data-section', 'commands');
  el.setAttribute('data-title', title);
  el.querySelector('.ts-dev-h').textContent = title;
  memo.bind(el, 'commands');
  var flags = el.querySelector('.ts-dev-conf-flags');
  function flag(cls, text, attr) {
    var c = flags.appendChild(h('<span class="ts-chip ' + cls + '"></span>'));
    c.textContent = text;
    c.setAttribute(attr, '1');
  }
  if (queued) {
    var n = queued.commands.length;
    flag(queued.unanswered ? 'fault' : 'warn', queued.unanswered ? t('device.noAnswer', 'No answer')
      : n === 1 ? t('device.changesQueuedOne', '1 change queued') : t('device.changesQueuedMany', '{n} changes queued', { n: n }), 'data-flag-queued');
  }
  if (last && !last.ok) { flag('fault', t('device.lastFailed', 'Last send failed'), 'data-flag-failed'); }
  var card = { el: el, body: el.querySelector('.ts-dev-card-body') };
  var sec = card.body;
  if (queued) {
    var row = h('<div class="ts-cmd" data-cmd="' + (queued.unanswered ? 'unanswered' : 'queued') + '"><div class="ts-cmd-top"></div><div class="ts-row-label"></div><div class="ts-row-meta"></div></div>');
    row.querySelector('.ts-cmd-top').appendChild(h('<span class="ts-chip ' + (queued.unanswered ? 'fault">' + esc(t('device.noAnswer', 'No answer')) : 'warn">' + esc(t('device.queuedChip', 'Queued'))) + '</span>'));
    row.querySelector('.ts-cmd-top').appendChild(h('<span class="ts-spacer"></span>'));
    row.querySelector('.ts-row-label').textContent = queued.commands.map(commandText).join(' · ');
    row.querySelector('.ts-row-meta').textContent = (queued.unanswered ? t('device.noAnswerSent', 'No answer, sent {ago}', { ago: t.ago(queued.sent) })
      : t('device.queuedSent', 'Queued, sent {ago}', { ago: t.ago(queued.sent) })) +
      (queued.frames > 1 ? ' · ' + t('device.frames', '{n} frames', { n: queued.frames }) : '') +
      (nextUplinkText() ? ' · ' + nextUplinkText() : '');
    row.querySelector('.ts-row-meta').dataset.nextUplink = nextUplink() || '';
    if (state.writable) {
      if (queued.unanswered) {
        row.querySelector('.ts-cmd-top').appendChild(h('<button type="button" class="ts-btn sm" data-a="retry">' + esc(t('device.retry', 'Retry')) + '</button>'))
          .addEventListener('click', function () { retry(queued); });
      }
      row.querySelector('.ts-cmd-top').appendChild(h('<button type="button" class="ts-btn sm" data-a="discard">' + esc(t('device.discard', 'Discard')) + '</button>'))
        .addEventListener('click', function () { discard(queued); });
    }
    sec.appendChild(row);
  }
  if (last) {
    var done = h('<div class="ts-cmd" data-cmd="' + (last.ok ? 'delivered' : 'failed') + '"><div class="ts-cmd-top"><span class="ts-chip ' + (last.ok ? 'ok">' + esc(t('device.delivered', 'Delivered')) : 'fault">' + esc(t('device.failed', 'Failed'))) + '</span></div>' +
      '<div class="ts-row-label"></div><div class="ts-row-meta"></div></div>');
    done.querySelector('.ts-row-label').textContent = (last.commands || []).map(commandText).join(' · ') || t('device.commandNumber', 'Command #{seq}', { seq: last.seq });
    done.querySelector('.ts-row-meta').textContent = (last.results || []).map(resultText).join(' · ') + ' · ' + t('device.answered', 'answered {ago}', { ago: t.ago(last.ackedAt) });
    sec.appendChild(done);
  }
  if (state.writable) {
    var bar = h('<div class="ts-cmdbar"><button type="button" class="ts-btn sm" data-a="reports">' + esc(t('device.requestReports', 'Request reports')) + '</button>' +
      '<button type="button" class="ts-btn sm" data-a="diag">' + esc(t('device.selfDiag', 'Self-diagnostic')) + '</button></div>');
    bar.appendChild(uplinkControl(Number(state.client['status.baseIntervalSeconds']) || 0));
    bar.addEventListener('click', function (e) {
      var a = e.target.closest('[data-a=reports], [data-a=diag]');
      if (!a) { return; }
      send([a.dataset.a === 'reports'
        ? { op: 'REQUEST_REPORT', target: { mode: 'GLOBAL' }, reports: ['topology', 'subscriptions', 'status', 'device_info'] }
        : { op: 'SELF_DIAG', target: { mode: 'GLOBAL' } }]);
    });
    sec.appendChild(bar);
  }
  return card.el;
}

// The device sends at most one round of uplinks per minute (TRX_NANO.md §12); the
// interval is a multiple of 5 s, up to what its wire version carries (§10).
var MIN_UPLINK_S = 60, UPLINK_STEP_S = 5;
function maxUplinkS() { return Number(state.client.wireVersion) === 3 ? 65535 * UPLINK_STEP_S : 65535; }

/** The longest gap between transmissions in s, from the subscriptions the device reports,
 * after `commands` when given, and its daily link check (TRX_NANO.md §12.0): `s`, and `data`,
 * the bound of the measurements sent every time, null without one. The ingest chain computes
 * the same for the inactivity timeout (HEALTH.md §1). */
var LINKCHECK_S = 86400;
function txGap(uplink, commands) {
  var subs = {}, c = state.client;
  Object.keys(c).forEach(function (key) {
    var m = /^subscriptions\.(.+)\.(interval|enabled|send)$/.exec(key);
    if (m) { (subs[m[1]] = subs[m[1]] || {})[m[2]] = c[key]; }
  });
  (commands || []).forEach(function (x) {
    var target = x.target || {};
    if (target.mode === 'GLOBAL') { if (x.op === 'SET_INTERVAL') { uplink = x.interval_s; } return; }
    var key = sourceKeyOf(target);
    if (x.op === 'DELETE_SUBSCRIPTION') { delete subs[key]; return; }
    var sub = subs[key] = subs[key] || {};
    if (x.op === 'CREATE_SUBSCRIPTION') { sub.enabled = true; sub.interval = x.interval_s; }
    if (x.op === 'SET_ENABLED') { sub.enabled = x.enabled; }
    if (x.op === 'SET_INTERVAL') { sub.interval = x.interval_s; }
  });
  if (!Object.keys(subs).length) { return { s: uplink, data: null }; }
  var lo = 0;
  Object.keys(subs).forEach(function (k) {
    var x = subs[k], iv = Number(x.interval);
    if (x.enabled === false || x.enabled === 'false') { return; }
    if ((x.send || 'all') === 'all' && iv > 0 && (!lo || iv < lo)) { lo = iv; }
  });
  var d = lo ? uplink * Math.ceil(lo / uplink) : null, lc = uplink * Math.ceil(LINKCHECK_S / uplink);
  return { s: d === null ? lc : Math.min(d, lc), data: d };
}

/** When the device transmits next at the latest: its last uplink plus its longest gap between
 * transmissions. A queued change goes out right after it. Null when either is unknown. */
function nextUplink() {
  var last = Number(state.server.lastActivityTime), uplink = Number(state.client['status.baseIntervalSeconds']);
  return last && uplink ? last + txGap(uplink).s * 1000 : null;
}

function nextUplinkText() {
  var at = nextUplink();
  if (!at) { return ''; }
  return at > Date.now() ? t('device.nextUplinkBy', 'next uplink planned by {time}', { time: ui.when(at) })
    : t('device.nextUplinkDue', 'next uplink due since {time}', { time: ui.when(at) });
}

/** The base uplink interval with its unit and *Set*, beside the other device-wide commands:
 * `SET_INTERVAL` on the whole device (DEVICE_VIEW.md §2, Commands). Minutes and hours only:
 * nothing under the device's uplink floor is offered. */
function uplinkControl(current) {
  var el = h('<div class="ts-uplink-set"><span class="ts-tsrc-every"><span class="ts-uplink-label"></span>' +
    ' <input class="ts-input num sm" type="number" min="1" step="1" inputmode="numeric"><select class="ts-select sm"></select>' +
    '<button type="button" class="ts-btn primary sm" data-a="uplink-interval" hidden>' + esc(t('device.set', 'Set')) + '</button></span></div>');
  el.querySelector('.ts-uplink-label').textContent = t('device.sendCollectedEvery', 'Send collected readings every');
  var input = el.querySelector('input'), unit = el.querySelector('select'), setBtn = el.querySelector('button');
  // A current value of whole seconds keeps the seconds unit so it shows as it is.
  var u = current ? unitFor(current) : null;
  UNITS.filter(function (x) { return x.s >= MIN_UPLINK_S || (u && x.s === u.s); }).forEach(function (x) {
    var o = document.createElement('option'); o.value = x.s; o.textContent = x.label; unit.appendChild(o);
  });
  if (u) {
    unit.value = u.s;
    input.value = current / u.s;
  } else {
    unit.value = 60;
    input.placeholder = '?';
  }
  var queued = ((pending() || {}).commands || []).filter(function (x) { return x.op === 'SET_INTERVAL' && (x.target || {}).mode === 'GLOBAL'; });
  if (queued.length) {
    var chip = el.appendChild(h('<span class="ts-chip warn" data-queued="1"></span>'));
    chip.textContent = t('device.changeQueued', 'change queued');
    chip.title = t('device.afterNextUplink', '{commands}, after the next uplink', { commands: queued.map(commandText).join(' · ') });
  }
  function seconds() { return Number(input.value) * Number(unit.value); }
  function changed() { setBtn.hidden = !input.value || seconds() === current; }
  input.addEventListener('input', changed);
  unit.addEventListener('change', changed);
  // Readings slower than the uplink: the logger transmits at their pace, not at each uplink.
  var tx = current ? txGap(current) : { s: null, data: null }, gap = tx.s;
  if (gap !== null && gap > current) {
    var note = el.appendChild(h('<div class="ts-uplink-gap"><span></span></div>'));
    note.firstChild.textContent = t('device.transmitsEvery', 'Transmits every {d}: no measurement is read more often', { d: fmtDuration(gap) });
    var offer = Math.ceil(gap / UPLINK_STEP_S) * UPLINK_STEP_S;
    if (tx.data !== null && tx.data > current && offer <= maxUplinkS() && offer <= 65535 * UPLINK_STEP_S) {
      var hint = note.appendChild(h('<button type="button" class="ts-btn sm" data-a="uplink-gap"></button>'));
      hint.textContent = t('device.setUplinkToGap', 'Set the uplink interval to {d}', { d: fmtDuration(offer) });
      hint.addEventListener('click', function () {
        var u2 = unitFor(offer);
        if (!unit.querySelector('option[value="' + u2.s + '"]')) { u2 = UNITS[1]; }
        unit.value = u2.s;
        input.value = offer / u2.s;
        changed();
      });
    }
  }
  setBtn.addEventListener('click', function () {
    var v = seconds();
    if (!(v >= MIN_UPLINK_S && v <= maxUplinkS() && v % UPLINK_STEP_S === 0)) {
      ui.toast(t('device.uplinkIntervalInvalid', 'The uplink interval is a multiple of 5 seconds, 60 to {max}', { max: maxUplinkS() }), 'error');
      return;
    }
    var cost = v < current ? t('device.uplinkShorter', 'A shorter uplink interval costs battery: the LOGR powers its bus and radio more often.')
      : t('device.uplinkNote', 'Every uplink powers the LOGR’s bus and radio: the shorter the interval, the more battery it costs.');
    var global = { op: 'SET_INTERVAL', target: { mode: 'GLOBAL' }, interval_s: v };
    var note = function (keep) {
      var warnings = current ? uplinkPlan(current, v, keep).warnings : [];
      return cost + (warnings.length ? '<ul class="ts-confirm-warn">' + warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '');
    };
    var tied = current ? uplinkPlan(current, v, true).multiples : [];
    if (!tied.length) { send([global], note(false)); return; }
    // The uplink interval first, then each kept multiple (DEVICE_VIEW.md §2, Commands).
    var commands = function (keep) {
      return [global].concat(!keep ? [] : tied.filter(function (m) { return m.seconds !== Number(m.source.interval); })
        .map(function (m) { return { op: 'SET_INTERVAL', target: sourceTarget(m.source), interval_s: m.seconds }; }));
    };
    send(commands, note, {
      label: t('device.keepMultiples', 'Keep the measurements sent every n uplinks tied to the uplinks: {list}', {
        list: tied.map(function (m) { return m.source.sourceKey + ' ' + everyUplinks(m.n); }).join(', ') }),
      checked: true
    });
  });
  return el;
}

/** TC-6, TC-7: the raw values behind the summary lines, closed, each tagged with where it
 * comes from: the LOGR's own STATUS / SUBSCRIPTIONS reports, or the network
 * server (TRX_NANO_COMPLIANCE.md §3). The cloud computes none of it. */
function detailsPart() {
  var c = state.client, lat = state.latest, bus = family() === 'bus';
  var srcs = bus ? sources() : [];
  var el = h('<details class="ts-dev-details" data-section="details"><summary><span class="ts-pos-chev">' + ICON.chev + '</span>' +
    '<span class="ts-dev-details-title"></span> ' + info('statusSources') + '</summary><div class="ts-dev-details-body"></div></details>');
  el.setAttribute('data-title', t('device.details', 'Details'));
  el.querySelector('.ts-dev-details-title').textContent = t('device.details', 'Details');
  memo.bind(el, 'details');
  var card = { el: el, body: el.querySelector('.ts-dev-details-body') };
  var hasStatus = c['status.baseIntervalSeconds'] !== undefined;
  if (hasStatus && c['status.reportedAt'] !== undefined) {
    card.body.appendChild(h('<div class="ts-dev-card-note"></div>')).textContent = t('device.statusReportedShort', 'status report {ago}', { ago: t.ago(Number(c['status.reportedAt'])) });
  }
  var dl = card.body.appendChild(h('<dl class="ts-dev-dl"></dl>'));
  var DEVICE = t('device.sourceDevice', 'device'), NETWORK = t('device.sourceNetwork', 'network');
  function row(stat, title, from, lines) {
    var el = dl.appendChild(h('<div class="ts-stat"><dt><span></span><span class="ts-stat-from"></span></dt><dd></dd></div>'));
    el.dataset.stat = stat;
    el.querySelector('dt span').textContent = title;
    el.querySelector('.ts-stat-from').textContent = from;
    var dd = el.querySelector('dd');
    lines.forEach(function (l) {
      var line = dd.appendChild(h('<div class="ts-stat-line"></div>'));
      [].concat(l).forEach(function (x) { line.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
    });
  }
  var subs = srcs.filter(function (x) { return x.enabled === true || x.enabled === 'true'; });
  var intervals = subs.map(function (x) { return Number(x.interval); }).filter(function (n) { return n > 0; });
  var lo = intervals.length ? Math.min.apply(null, intervals) : 0, hi = intervals.length ? Math.max.apply(null, intervals) : 0;
  if (bus) {
    row('Reporting', t('device.statReporting', 'Reporting'), DEVICE, [
      hasStatus ? t('device.uplinkEvery', 'Uplink every {d}', { d: fmtDuration(c['status.baseIntervalSeconds']) }) : t('device.uplinkUnknown', 'Uplink interval not reported'),
      subs.length
        ? (subs.length === 1 ? t('device.subscriptionOne', '1 measurement sent') : t('device.subscriptionMany', '{n} measurements sent', { n: subs.length })) +
          (intervals.length ? t('device.subsEvery', ', every {d}', { d: fmtDuration(lo) }) + (hi !== lo ? t('device.subsTo', ' to {d}', { d: fmtDuration(hi) }) : '') : '')
        : t('device.noSubscription', 'No sent measurement reported')
    ]);
  }
  var net = [];
  var sf = state.server.spreadingFactor !== undefined ? state.server.spreadingFactor : c.spreadingFactor;
  var link = [];
  if (lat.rssi) { link.push(metric(lat.rssi.value + ' dBm', rssiLevel(lat.rssi.value))); }
  if (lat.snr) { link.push(metric('SNR ' + lat.snr.value + ' dB', snrLevel(lat.snr.value))); }
  if (sf !== undefined) { link.push(metric('SF' + sf, sfLevel(sf))); }
  if (link.length) { net.push(joined(link)); }
  var gws = parseJson(c.gateways || state.server.gateways) || [];
  if (gws.length) {
    var g0 = gws[0];
    net.push([g0.id + ' '].concat(g0.rssi !== undefined && g0.rssi !== null ? [metric(g0.rssi + ' dBm', rssiLevel(g0.rssi))] : [])
      .concat(gws.length > 1 ? [' · ' + (gws.length === 2 ? t('device.andOneOther', 'and 1 other') : t('device.andOthers', 'and {n} others', { n: gws.length - 1 }))] : []));
  }
  if (family() !== 'other' || net.length) {
    row('Uplink radio', t('device.statUplink', 'Uplink radio'), NETWORK, net.length ? net : [t('device.nothingFromNetwork', 'Nothing from the network server yet')]);
  }
  if (hasStatus) {
    row('Downlink radio', t('device.statDownlink', 'Downlink radio'), DEVICE, [joined([metric(c['status.dlRssi'] + ' dBm', rssiLevel(c['status.dlRssi'])),
      metric('SNR ' + c['status.dlSnr'] + ' dB', snrLevel(c['status.dlSnr']))])]);
  }
  var unread = hasStatus && powerUnread(c);
  var b = batteryFacts();
  var batt = [];
  if (b.soc !== undefined) { batt.push(t('device.charge', 'Charge {v} %', { v: fmtValue(b.soc) })); }
  else if (b.socUnread) { batt.push(t('device.chargeUnread', 'Charge not reported: the power board did not answer')); }
  if (b.volt) { batt.push(fmtValue(b.volt.value) + ' V, ' + t.ago(b.volt.ts)); }
  if (!hasStatus && c['status.charging'] !== undefined) { batt.push(truthyFlag(c['status.charging']) ? t('device.charging', 'Charging') : t('device.notCharging', 'Not charging')); }
  if (b.runtime) { batt.push(t('device.runtime', 'Lasts about {d}, the LOGR’s own estimate', { d: fmtDuration(b.runtime) })); }
  if (bus || batt.length) { row('Battery', t('common.battery', 'Battery'), DEVICE, batt.length ? batt : [t('device.notReported', 'Not reported')]); }
  if (hasStatus) {
    var present = parseJson(c['status.sourcesPresent']) || [], powerNames = powerSources(), source = c['status.activeSource'];
    // active_source is the charge path: with none the LOGR runs on its battery.
    var powerUnknown = unread || source === UNKNOWN;
    var power = powerUnknown ? [t('device.powerUnread', 'Power inputs not reported: the power board did not answer')]
      : [source === 'none' ? t('device.runningOnBattery', 'Running on battery') : t('device.runningOn', 'Running on {source}', { source: powerNames[source] || source }),
         t('device.connected', 'Connected: {list}', { list: present.length ? present.map(function (x) { return powerNames[x] || x; }).join(', ') : t('common.none', 'none') })];
    if (!powerUnknown && truthyFlag(c['status.charging'])) {
      power.push(Number(c['status.ttfSeconds']) > 0 ? t('device.chargingFullIn', 'Charging, full in {d}', { d: fmtDuration(c['status.ttfSeconds']) }) : t('device.charging', 'Charging'));
    }
    row('Power', t('device.statPower', 'Power'), DEVICE, power);
    var sd = c['status.sdState'];
    row('SD card', t('device.statSd', 'SD card'), DEVICE, [sd === 'ready'
      ? t('device.sdUsed', '{used} % used of {total} GiB', { used: fmtValue(c['status.sdUsedPercent']), total: c['status.sdTotalGib'] })
      : (sdStates()[sd] || String(sd))]);
  }
  var fix = lat['p0.gnssFix'] && parseJson(lat['p0.gnssFix'].value);
  if (bus && fix && fix.lat !== undefined) {
    row('Location', t('common.location', 'Location'), DEVICE,
      [Number(fix.lat).toFixed(5) + ', ' + Number(fix.lon).toFixed(5) + ' · ' + t('device.satellites', '{n} satellites', { n: fix.sats })]);
  }
  if (bus && !hasStatus) {
    card.body.appendChild(h('<div class="ts-field-hint"></div>')).textContent = state.writable
      ? t('device.noStatusWritable', 'No STATUS report from this LOGR yet: charge, power, SD card and downlink radio appear after its next one (Request reports below asks for it).')
      : t('device.noStatus', 'No STATUS report from this LOGR yet: charge, power, SD card and downlink radio appear after its next one.');
  }
  if (family() === 'logr2') {
    card.body.appendChild(h('<div class="ts-field-hint"></div>')).textContent = t('device.noRemoteConfig', 'No remote configuration: nothing is sent to a LOGR2.');
  }
  return dl.childNodes.length ? card.el : null;
}

/** Items, each a string, a node or a list of both, flattened with `sep` between them. */
function joined(items, sep) {
  return items.reduce(function (out, x, i) { return out.concat(i ? [sep || ' · '] : [], x); }, []);
}

function truthyFlag(v) { return v === true || v === 'true' || v === 1; }

// -- load -------------------------------------------------------------------------------

// A live update re-reads the device once the updates pause, so a report of several frames renders once.
// The poll is the fallback: while the live updates run it reads only past LIVE_POLL_MS.
var timer = null, live = null, liveTimer = null, running = null, again = false, deferred = false;

function stop() {
  clearInterval(timer);
  clearTimeout(liveTimer);
  if (live) { live.close(); live = null; }
}

function editing() {
  var focus = document.activeElement;
  return focus && bodyEl.contains(focus) && /^(INPUT|SELECT)$/.test(focus.tagName);
}

function refresh() {
  if (!root.isConnected && timer) { stop(); return Promise.resolve(); }
  if (editing()) { deferred = true; return Promise.resolve(); }
  if (running) { again = true; return running; }
  refreshBtn.disabled = true;
  running = loadDevice(state.device.id.id).then(render).catch(function (err) {
    ui.toast(t('common.refreshFailed', 'Refresh failed: {error}', { error: err && err.message ? err.message : err }), 'error');
  }).then(function () {
    refreshBtn.disabled = false;
    running = null;
    if (again) { again = false; return refresh(); }
  });
  return running;
}
refreshBtn.addEventListener('click', refresh);
// A refresh held back by an edit runs once the focus leaves the field.
bodyEl.addEventListener('focusout', function () {
  setTimeout(function () { if (deferred && !editing()) { deferred = false; refresh(); } }, 0);
});

function liveChange() {
  if (!root.isConnected) { stop(); return; }
  clearTimeout(liveTimer);
  liveTimer = setTimeout(refresh, LIVE_SETTLE_MS);
}

function poll() {
  if (live && live.healthy() && Date.now() - state.loadedAt < LIVE_POLL_MS) { return; }
  refresh();
}

tb.boundDatasource().then(function (ds) {
  if (!ds || ds.entityType !== 'DEVICE') { fail(t('device.noDeviceBound', 'No device bound — bind a device in the widget\'s Data tab.')); return; }
  return Promise.all([loadDefaults(), loadDevice(ds.entityId), tb.currentUser()]).then(function (got) {
    state.me = got[2];
    memo.user(state.me && state.me.id && state.me.id.id);
    return tb.canWrite(deviceEntity());
  }).then(function (writable) {
    state.writable = writable;
    render();
    timer = setInterval(poll, REFRESH_MS);
    live = tb.watch(deviceEntity(), ['CLIENT_SCOPE', 'SERVER_SCOPE'], liveChange);
    if (ctx.registerDestroyCallback) { ctx.registerDestroyCallback(stop); }
    // Opened from a station's *Connect a device*: the connect panel, that station picked;
    // a station this device already feeds opens its channels instead.
    var connectTo = (ctx.stateController.getStateParams() || {}).connectTo;
    var fed = connectTo && state.bindings.filter(function (b) { return b.station.id === connectTo.id; })[0];
    if (connectTo && writable) { bindDrawer(fed || null, fed ? null : connectTo); }
  });
}).catch(function (err) { fail(t('common.loadFailed', 'Could not load: {error}', { error: err && err.message ? err.message : err })); });

};
