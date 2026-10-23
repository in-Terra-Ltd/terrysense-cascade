/*
 * ThingsBoard access for the terrySense config widgets —
 * `window.TerrySenseTbIo(ctx)`. Plain-HTML html_container mode: services come
 * from `ctx.$scope.$injector.get(ctx.servicesMap.get('<name>'))`
 * (logr-product-docs/cloud/FRONTEND.md *Custom widget delivery*).
 *
 * `io` is the resolver's contract (shared/resolver.js header), plus
 * `fetchUser`.
 */
(function (root) {
'use strict';

root.TerrySenseTbIo = function (ctx) {
  var resolver = root.TerrySenseResolver;

  function getService(name) { return ctx.$scope.$injector.get(ctx.servicesMap.get(name)); }

  function toPromise(observable) {
    return new Promise(function (resolve, reject) {
      observable.subscribe({ next: function (v) { resolve(v); }, error: function (e) { reject(e); } });
    });
  }

  function get(url, params) { return toPromise(getService('http').get(url, { params: params || {} })); }
  function post(url, body) { return toPromise(getService('http').post(url, body || {})); }
  function del(url, params) { return toPromise(getService('http').delete(url, { params: params || {} })); }

  /** Every item of a paged listing, page after page. */
  function getAll(url, params) {
    var items = [];
    function page(n) {
      return get(url, Object.assign({}, params, { pageSize: '500', page: String(n) })).then(function (p) {
        items = items.concat((p && p.data) || []);
        return p && p.hasNext ? page(n + 1) : items;
      });
    }
    return page(0);
  }

  function idObj(entity) { return { entityType: entity.entityType, id: entity.id }; }

  function attrsMap(entity, scope) {
    return toPromise(getService('attributeService').getEntityAttributes(idObj(entity), scope || 'SERVER_SCOPE'))
      .then(function (list) {
        var map = {};
        (list || []).forEach(function (a) { map[a.key] = a.value; });
        return map;
      })
      .catch(function () { return {}; });
  }

  function saveAttrs(entity, attrs, scope) {
    var pairs = Object.keys(attrs || {}).map(function (k) { return { key: k, value: attrs[k] }; });
    if (!pairs.length) { return Promise.resolve(); }
    return toPromise(getService('attributeService').saveEntityAttributes(idObj(entity), scope || 'SERVER_SCOPE', pairs));
  }

  function deleteAttrs(entity, keys) {
    if (!keys || !keys.length) { return Promise.resolve(); }
    return toPromise(getService('attributeService').deleteEntityAttributes(idObj(entity), 'SERVER_SCOPE',
      keys.map(function (k) { return { key: k }; })));
  }

  function getAsset(id) { return toPromise(getService('assetService').getAsset(id)); }
  // `name` is what the user reads, `key` the generated name (ENTITY_MODEL.md *Names and labels*).
  function assetLevel(a) { return { entityType: 'ASSET', id: a.id.id, name: a.label || a.name, key: a.name, kind: a.type }; }
  function deviceLevel(d) { return { entityType: 'DEVICE', id: d.id.id, name: d.label || d.name, key: d.name, kind: d.type }; }

  function relatedAssets(entityId, direction) {
    var query = {
      parameters: { rootId: entityId, rootType: 'ASSET', direction: direction, relationTypeGroup: 'COMMON', maxLevel: 1, fetchLastLevelOnly: false },
      filters: [{ relationType: 'Contains', entityTypes: ['ASSET'] }]
    };
    return toPromise(getService('entityRelationService').findByQuery(query)).then(function (relations) {
      var ids = {};
      (relations || []).forEach(function (r) {
        var other = direction === 'FROM' ? r.to : r.from;
        if (other.entityType === 'ASSET') { ids[other.id] = true; }
      });
      // A relation can outlive the asset it points to.
      return Promise.all(Object.keys(ids).map(function (id) { return getAsset(id).catch(function () { return null; }); }))
        .then(function (assets) { return assets.filter(Boolean); });
    });
  }

  var defaultsPromise = null, tenantBookPromise = null;

  var io = {
    fetchAttrs: function (entity) { return attrsMap(entity); },
    fetchClientAttrs: function (entity) { return attrsMap(entity, 'CLIENT_SCOPE'); },
    fetchDevice: function (id) {
      return get('/api/device/' + id).then(function (d) { return d ? deviceLevel(d) : null; }).catch(function () { return null; });
    },
    fetchParent: function (entity) {
      return relatedAssets(entity.id, 'TO').then(function (assets) { return assets.length ? assetLevel(assets[0]) : null; });
    },
    fetchChildren: function (entity) {
      return relatedAssets(entity.id, 'FROM').then(function (assets) { return assets.map(assetLevel); });
    },
    // `ownerId` (not `customerId`) is the immediate owner ThingsBoard PE stamps
    // on every asset — the field config_resolver.py reads for the same lookup.
    fetchCustomer: function (entity) {
      return getAsset(entity.id).then(function (asset) {
        var owner = asset.ownerId;
        if (!owner || owner.entityType !== 'CUSTOMER') { return null; }
        return toPromise(getService('customerService').getCustomer(owner.id)).then(function (c) {
          return { entityType: 'CUSTOMER', id: owner.id, name: c.title || c.name };
        });
      });
    },
    // The one lookup with no Angular service wrapper, so it goes through http.
    fetchDefaults: function () {
      if (!defaultsPromise) {
        defaultsPromise = get('/api/user/assets', { type: 'Defaults', pageSize: '1', page: '0' }).then(function (page) {
          var item = page && page.data && page.data[0];
          return item ? { entityType: 'ASSET', id: item.id.id, name: item.name, kind: 'Defaults' } : null;
        }).catch(function () { return null; });
      }
      return defaultsPromise;
    },
    // The tenant's address book, never shared: a customer user finds none. Not
    // cached while absent, so the one the Settings widget creates is found next.
    fetchTenantBook: function () {
      if (!tenantBookPromise) {
        tenantBookPromise = get('/api/user/assets', { type: resolver.CONTACT_BOOK_KIND, pageSize: '1', page: '0' }).then(function (page) {
          var item = page && page.data && page.data[0];
          if (!item) { tenantBookPromise = null; }
          return item ? { entityType: 'ASSET', id: item.id.id, name: item.name, kind: resolver.CONTACT_BOOK_KIND } : null;
        }).catch(function () { tenantBookPromise = null; return null; });
      }
      return tenantBookPromise;
    },
    // Ownership is orthogonal to `Contains` (ENTITY_MODEL.md §1): a customer's
    // stations are found by ownership, not by walking relations.
    fetchCustomerStations: function (customer) {
      return getAll('/api/customer/' + customer.id + '/assets', { type: 'Station' }).then(function (list) { return list.map(assetLevel); });
    },
    // Every station the user can see: all of them for a tenant admin, the only
    // user who can write the DEFAULTS asset.
    fetchAllStations: function () {
      return getAll('/api/user/assets', { type: 'Station' }).then(function (list) { return list.map(assetLevel); });
    },
    // The device branch (CONFIG_CASCADE.md §1): the DeviceDefaults asset named
    // after a profile, shared read-only with every customer like DEFAULTS.
    fetchDeviceDefaults: function (profile) {
      return get('/api/user/assets', { type: resolver.DEVICE_DEFAULTS_KIND, textSearch: profile, pageSize: '50', page: '0' })
        .then(function (page) {
          var item = ((page && page.data) || []).filter(function (a) { return a.name === profile; })[0];
          return item ? { entityType: 'ASSET', id: item.id.id, name: item.name, kind: resolver.DEVICE_DEFAULTS_KIND } : null;
        }).catch(function () { return null; });
    },
    fetchProfileDevices: function (profile) {
      return getAll('/api/user/devices', { type: profile }).then(function (list) { return list.map(deviceLevel); });
    },
    fetchAllDevices: function () {
      return getAll('/api/user/devices', {}).then(function (list) { return list.map(deviceLevel); });
    },
    // A user's own notification switches, from their profile, ride along as `switches`.
    fetchUser: function (id) {
      return get('/api/user/' + id).then(function (u) {
        u.switches = switchesOf(u);
        return u;
      }).catch(function () { return null; });
    }
  };

  /** The entity bound in the widget's Data tab, resolved through its alias. */
  function boundDatasource() {
    var live = ctx.datasources && ctx.datasources[0];
    if (live && live.entityId) { return Promise.resolve(live); }
    var configured = ctx.widget && ctx.widget.config && ctx.widget.config.datasources;
    if (!configured || !configured.length) { return Promise.resolve(null); }
    return toPromise(ctx.aliasController.resolveDatasources(JSON.parse(JSON.stringify(configured)), true))
      .then(function (resolved) { return (resolved || []).filter(function (d) { return d && d.entityId; })[0] || null; });
  }

  function loadEntity(ds) {
    if (ds.entityType === 'CUSTOMER') {
      return toPromise(getService('customerService').getCustomer(ds.entityId)).then(function (c) {
        return { entityType: 'CUSTOMER', id: ds.entityId, name: c.title || c.name, kind: 'Customer', ownerId: ds.entityId };
      });
    }
    if (ds.entityType === 'DEVICE') {
      return toPromise(getService('deviceService').getDevice(ds.entityId)).then(function (d) {
        var level = deviceLevel(d);
        level.ownerId = d.ownerId && d.ownerId.id;
        return level;
      });
    }
    return getAsset(ds.entityId).then(function (a) {
      var level = assetLevel(a);
      level.ownerId = a.ownerId && a.ownerId.id;
      return level;
    });
  }

  var mePromise = null, permsPromise = null;
  function currentUser() { return mePromise || (mePromise = get('/api/auth/user')); }
  function permissions() {
    return permsPromise || (permsPromise = get('/api/permissions/allowedPermissions').catch(function () { return null; }));
  }

  /** Whether the signed-in user may write this entity's attributes: a tenant
   * admin always; a customer user through a generic write permission, on an
   * entity their customer owns. Anyone else sees the widget read-only. */
  function canWrite(entity) {
    return Promise.all([currentUser(), permissions()]).then(function (got) {
      var me = got[0] || {}, perms = got[1];
      if (me.authority === 'TENANT_ADMIN') { return true; }
      if (me.authority !== 'CUSTOMER_USER' || !perms) { return false; }
      var generic = (perms.userPermissions || {}).genericPermissions || {};
      var resource = entity.entityType === 'CUSTOMER' || entity.entityType === 'DEVICE' ? entity.entityType : 'ASSET';
      var ops = (generic[resource] || []).concat(generic.ALL || []);
      var writes = ops.indexOf('ALL') >= 0 || ops.indexOf('WRITE_ATTRIBUTES') >= 0;
      var owner = perms.userOwnerId && (perms.userOwnerId.id || perms.userOwnerId);
      return writes && !!owner && owner === entity.ownerId;
    });
  }

  /** Platform users a contact can be picked from: the customer's, else the tenant's. */
  function listUsers(customerId) {
    return getAll(customerId ? '/api/customer/' + customerId + '/users' : '/api/user/users');
  }

  /** Re-resolve `stations` and write only what changed (every attribute write
   * re-triggers `station_entry`). */
  function resolveStations(stations) {
    return Promise.all(stations.map(function (station) {
      return Promise.all([resolver.resolveStation(station, io), io.fetchAttrs(station)]).then(function (r) {
        var diff = resolver.effectiveDiff(r[1], r[0]);
        return saveAttrs(station, diff.toWrite).then(function () { return deleteAttrs(station, diff.toDelete); });
      });
    }));
  }

  // -- channel staleness (HEALTH.md §2) ---------------------------------------
  // A channel is stale when its newest reading is older than three measurement
  // intervals of its own source: the device's `subscriptions.<key>.interval` on
  // a LOGR3 or LOGR4, its `register.intervalSeconds` on any other device.
  var STALE_FACTOR = 3;
  var intervalCache = {};

  function deviceIntervals(deviceId) {
    if (!intervalCache[deviceId]) {
      var base = '/api/plugins/telemetry/DEVICE/' + deviceId + '/values/attributes/';
      intervalCache[deviceId] = Promise.all([
        get(base + 'CLIENT_SCOPE').catch(function () { return []; }),
        get(base + 'SERVER_SCOPE', { keys: 'register.intervalSeconds' }).catch(function () { return []; })
      ]).then(function (got) {
        var m = {};
        (got[0] || []).concat(got[1] || []).forEach(function (a) { m[a.key] = a.value; });
        return m;
      });
    }
    return intervalCache[deviceId];
  }

  /** `{channels: {channel: {ts, intervalS, stale}}, stale: [channel], total}` for a
   * station, from its attributes and `latest` (`{channel: ts}`). `stale` is null
   * for a channel whose interval is unknown. A calculated channel is stale when
   * one of its inputs is. */
  function channelFreshness(stationAttrs, latest, names) {
    var entries = resolver.mapEntries(stationAttrs['config.channelMap']);
    var channels = Object.keys(entries);
    return Promise.all(channels.map(function (c) {
      var e = entries[c];
      return e.device ? deviceIntervals(e.device) : Promise.resolve({});
    })).then(function (intervals) {
      var out = {}, now = Date.now();
      channels.forEach(function (c, i) {
        var a = intervals[i], key = entries[c].key;
        var s = Number(a['subscriptions.' + key + '.interval'] || a['register.intervalSeconds'] || a['status.baseIntervalSeconds']) || 0;
        var ts = latest[c] || 0;
        out[c] = { ts: ts, intervalS: s || null, stale: s ? !ts || now - ts > STALE_FACTOR * s * 1000 : null };
      });
      resolver.calculatedChannels(entries, stationAttrs, names || {}).forEach(function (c) {
        var inputs = (((names || {})[c] || {}).calculated || {}).channels || [];
        var known = inputs.filter(function (x) { return out[x] && out[x].stale !== null; });
        out[c] = { ts: latest[c] || 0, intervalS: null,
          stale: known.length ? known.some(function (x) { return out[x].stale; }) : null };
      });
      var names_ = Object.keys(out);
      return { channels: out, stale: names_.filter(function (c) { return out[c].stale === true; }), total: names_.length };
    });
  }

  /** A LOGR3 or LOGR4 has a bus and remote configuration (DEVICE_VIEW.md §2). */
  function isComplexDevice(type) { return type === 'logr3' || type === 'logr4'; }

  /** The assets above `entity` over `Contains`, nearest first, up to its project. */
  function ancestors(entity) {
    var chain = [];
    function up(level) {
      if (chain.length >= 5) { return Promise.resolve(chain); }
      return io.fetchParent(level).then(function (parent) {
        if (!parent) { return chain; }
        chain.push(parent);
        return parent.kind === 'Project' ? chain : up(parent);
      });
    }
    return up(entity).catch(function () { return chain; });
  }

  /** ThingsBoard's own encoding of the `state` query parameter. */
  function encodeState(states) {
    return btoa(encodeURIComponent(JSON.stringify(states)).replace(/%([0-9A-F]{2})/g,
      function (m, hex) { return String.fromCharCode(parseInt(hex, 16)); }));
  }

  /** `id` when the user can open that dashboard, else null: a stored link can outlive its dashboard. */
  function readableDashboard(id) {
    if (!id) { return Promise.resolve(null); }
    // A dashboard deleted or unshared since the link was written is no error to show.
    return toPromise(getService('dashboardService').getDashboardInfo(id, { ignoreErrors: true }))
      .then(function () { return id; }).catch(function () { return null; });
  }

  /** A dashboard opened through a public link: its route is /dashboard, not /dashboards. */
  function isPublicView() { return /^\/dashboard\//.test(window.location.pathname); }

  function viewStates(stateId, entity, extra) {
    return [{ id: 'default', params: {} },
      { id: stateId, params: Object.assign({ entityId: { entityType: entity.entityType || 'ASSET', id: entity.id }, entityName: entity.key || entity.name, entityLabel: entity.name }, extra) }];
  }

  /** Open view `stateId` of dashboard `dashboardId` on `entity`, above its
   * landing view; with no `stateId`, its landing view. `extra` joins the
   * view's state params. A public link stays public: its route is
   * /dashboard, and it keeps publicId. */
  function openDashboard(dashboardId, stateId, entity, extra) {
    var isPublic = isPublicView();
    var params = stateId ? { state: encodeState(viewStates(stateId, entity, extra)) } : {};
    var publicId = isPublic && new URLSearchParams(window.location.search).get('publicId');
    if (publicId) { params.publicId = publicId; }
    // On PE the edit rights come from the dashboard's group: its *All* group, as the dashboard list opens it.
    getService('router').navigate(isPublic ? ['/dashboard', dashboardId] : ['/dashboards', 'all', dashboardId], { queryParams: params });
  }

  /** A project's name leads to its project dashboard, a station's to its
   * charts, when the user can read it; else to its Installation view on
   * `projectDashboardId` (FRONTEND.md *Navigation*). */
  function openProject(projectDashboardId, project) {
    return attrsMap(project).then(function (a) { return readableDashboard(a['config.homeDashboard']); }).then(function (id) {
      if (id) { openDashboard(id); } else { openDashboard(projectDashboardId, 'project', project); }
    });
  }

  function openStation(projectDashboardId, station) {
    return attrsMap(station).then(function (a) { return readableDashboard(a['config.stationDashboard']); }).then(function (id) {
      openDashboard(id || projectDashboardId, 'station', station);
    });
  }

  /** The URL a public link opens: view `stateId` of `dashboardId` on `entity`,
   * else its landing view, signed in as public customer `publicId`. */
  function publicLink(dashboardId, publicId, stateId, entity) {
    return window.location.origin + '/dashboard/' + dashboardId + '?publicId=' + publicId +
      (stateId ? '&state=' + encodeURIComponent(encodeState(viewStates(stateId, entity))) : '');
  }

  // -- lifecycle of a project, station or device (FRONTEND.md *Interface conventions*) --

  var PUBLIC_GROUP = 'Public';
  var GROUP_PATH = { ASSET: 'assets', DEVICE: 'devices', DASHBOARD: 'dashboards' };

  function entityPath(entity) { return entity.entityType === 'DEVICE' ? 'device' : 'asset'; }

  /** `{entityType, id}` of the entity's immediate owner. */
  function ownerOf(entity) {
    return get('/api/' + entityPath(entity) + '/' + entity.id).then(function (e) { return e.ownerId; });
  }

  // -- names and labels (ENTITY_MODEL.md *Names and labels*) ----------------------

  var naming = root.TerrySenseNaming;

  /** The owner's customer code; a customer without a valid one cannot name anything. */
  function customerCode(owner) {
    if (owner.entityType !== 'CUSTOMER') { return Promise.resolve(naming.TENANT_CODE); }
    return attrsMap({ entityType: 'CUSTOMER', id: owner.id }).then(function (a) {
      var code = a['config.customerCode'];
      if (!naming.validCode(code)) {
        throw new Error(root.TerrySenseT('lifecycle.noCode', 'The customer has no customer code: a tenant admin sets it first'));
      }
      return code;
    });
  }

  /** The first of `build(1)`, `build(2)`… no other asset carries. Listed by
   * `prefix` rather than tried, since a refused save raises ThingsBoard's error popup. */
  function freeName(prefix, build, selfId) {
    return getAll('/api/user/assets', { textSearch: prefix }).then(function (list) {
      var taken = {};
      list.forEach(function (a) { if (a.id.id !== selfId) { taken[a.name] = true; } });
      var n = 1;
      while (taken[build(n)]) { n++; }
      return build(n);
    });
  }

  function projectNameFor(owner, label, selfId) {
    return customerCode(owner).then(function (code) {
      return freeName(code + '_', function (n) { return naming.projectName(code, label, n); }, selfId);
    });
  }

  function stationNameFor(projectKey, label, selfId) {
    return freeName(projectKey + '_', function (n) { return naming.stationName(projectKey, label, n); }, selfId);
  }

  function saveAsset(asset, fields) {
    return post('/api/asset', Object.assign(asset, fields));
  }

  /** The station's name rebuilt under `projectId`, its label kept or replaced by `label`. */
  function renameStation(stationId, projectId, label) {
    return Promise.all([getAsset(stationId), getAsset(projectId)]).then(function (got) {
      var s = got[0], text = label === undefined ? s.label || s.name : label;
      return stationNameFor(got[1].name, text, s.id.id).then(function (name) { return saveAsset(s, { name: name, label: text }); });
    });
  }

  /** The project's name rebuilt, its label kept or replaced by `label`, then each of its stations'. */
  function renameProject(projectId, label) {
    return getAsset(projectId).then(function (p) {
      var text = label === undefined ? p.label || p.name : label;
      return projectNameFor(p.ownerId, text, p.id.id).then(function (name) { return saveAsset(p, { name: name, label: text }); });
    }).then(function (saved) {
      return relatedAssets(saved.id.id, 'FROM').then(function (children) {
        return children.filter(function (a) { return a.type === 'Station'; }).reduce(function (done, s) {
          return done.then(function () { return renameStation(s.id.id, saved.id.id); });
        }, Promise.resolve());
      }).then(function () { return saved; });
    });
  }

  /** Give a project or station the label `label`, its name rebuilt from it. */
  function relabel(entity, label) {
    var work = entity.kind === 'Project' ? renameProject(entity.id, label)
      : io.fetchParent(entity).then(function (project) { return renameStation(entity.id, project.id, label); });
    return work.then(function (saved) { entity.name = label; entity.key = saved.name; });
  }

  /** The other stations of `project` labelled `label`, ignoring case. */
  function sameLabel(project, label, selfId) {
    var wanted = String(label).trim().toLowerCase();
    return io.fetchChildren(project).then(function (children) {
      return children.filter(function (c) { return c.kind === 'Station' && c.id !== selfId && c.name.trim().toLowerCase() === wanted; });
    });
  }

  /** A new project of `owner` (`{entityType, id}`), labelled `label`. */
  function createProject(label, owner) {
    return projectNameFor(owner, label).then(function (name) {
      var body = { name: name, label: label, type: 'Project' };
      if (owner.entityType === 'CUSTOMER') { body.customerId = owner; }
      return post('/api/asset', body);
    });
  }

  /** The owner's groups of `type` (ASSET, DEVICE or DASHBOARD) made public, each with
   * `members` ({id: true}), and `ids`, every entity in one of them. Never another owner's. */
  function publicMembers(owner, type) {
    type = type || 'ASSET';
    return get('/api/entityGroups/' + owner.entityType + '/' + owner.id + '/' + type).then(function (all) {
      var groups = (all || []).filter(function (g) { return (g.additionalInfo || {}).isPublic; });
      return Promise.all(groups.map(function (g) {
        return getAll('/api/entityGroup/' + g.id.id + '/' + GROUP_PATH[type]).then(function (list) {
          g.members = {};
          list.forEach(function (e) { g.members[e.id.id] = true; });
          return g;
        });
      })).then(function () {
        var ids = {};
        groups.forEach(function (g) { Object.assign(ids, g.members); });
        return { all: all || [], groups: groups, ids: ids };
      });
    });
  }

  /** The owner's group of `type` named `name`, created when it has none. Found in
   * the owner's list, since asking for a missing group by name raises ThingsBoard's error popup. */
  function namedGroup(owner, type, name) {
    return get('/api/entityGroups/' + owner.entityType + '/' + owner.id + '/' + type).then(function (all) {
      return (all || []).filter(function (g) { return g.name === name; })[0] ||
        post('/api/entityGroup', { type: type, name: name, ownerId: owner });
    });
  }

  /** The owner's public group, made public from its "Public" group or created when it has none. */
  function ensurePublicGroup(owner, type, pub) {
    if (pub.groups.length) { return Promise.resolve(pub.groups[0]); }
    var named = pub.all.filter(function (g) { return g.name === PUBLIC_GROUP; })[0];
    return (named ? Promise.resolve(named) : post('/api/entityGroup', { type: type, name: PUBLIC_GROUP, ownerId: owner }))
      .then(function (g) { return post('/api/entityGroup/' + g.id.id + '/makePublic').then(function () { return g; }); });
  }

  /** Put `entity` in its owner's public group, or take it out of every one (FRONTEND.md *Public links*). */
  function setPublic(entity, owner, on) {
    var type = entity.entityType === 'DEVICE' || entity.entityType === 'DASHBOARD' ? entity.entityType : 'ASSET';
    return publicMembers(owner, type).then(function (pub) {
      if (!on) {
        return Promise.all(pub.groups.filter(function (g) { return g.members[entity.id]; }).map(function (g) {
          return post('/api/entityGroup/' + g.id.id + '/deleteEntities', [entity.id]);
        }));
      }
      if (pub.ids[entity.id]) { return null; }
      return ensurePublicGroup(owner, type, pub).then(function (g) { return post('/api/entityGroup/' + g.id.id + '/addEntities', [entity.id]); });
    });
  }

  function relate(from, to) {
    return post('/api/relation', { from: { id: from.id, entityType: from.entityType }, to: { id: to.id, entityType: to.entityType },
      type: 'Contains', typeGroup: 'COMMON' });
  }

  function unrelate(from, to) {
    return del('/api/relation', { fromId: from.id, fromType: from.entityType, toId: to.id, toType: to.entityType,
      relationType: 'Contains', relationTypeGroup: 'COMMON' });
  }

  /** A new station labelled `label`, owned by the project's owner, `Contains`-related from it,
   * carrying `attrs`, public when the project is, and resolved. */
  function createStation(label, project, attrs) {
    return getAsset(project.id).then(function (p) {
      var owner = p.ownerId;
      return stationNameFor(p.name, label).then(function (name) {
        var body = { name: name, label: label, type: 'Station' };
        if (owner.entityType === 'CUSTOMER') { body.customerId = owner; }
        return post('/api/asset', body);
      }).then(function (created) {
        var station = assetLevel(created);
        station.ownerId = owner.id;
        return relate(project, station)
          .then(function () { return saveAttrs(station, attrs); })
          .then(function () { return publicMembers(owner); })
          .then(function (pub) { return pub.ids[project.id] ? setPublic(station, owner, true) : null; })
          .then(function () { return resolveStations([station]); })
          .then(function () { return station; });
      });
    });
  }

  /** The owner's projects. */
  function ownerProjects(owner) {
    var list = owner.entityType === 'CUSTOMER'
      ? getAll('/api/customer/' + owner.id + '/assets', { type: 'Project' })
      : getAll('/api/tenant/assets', { type: 'Project' }).then(function (all) {
        return all.filter(function (a) { return a.ownerId.entityType === 'TENANT'; });
      });
    return list.then(function (assets) { return assets.map(assetLevel); });
  }

  /** `[{key, from, to}]`: the `effective.*` values that change when `station` moves under `parent`. */
  function settingChanges(station, parent) {
    var moved = Object.assign({}, io, {
      fetchParent: function (e) { return e.id === station.id ? Promise.resolve(parent) : io.fetchParent(e); }
    });
    return Promise.all([resolver.resolveStation(station, io), resolver.resolveStation(station, moved)]).then(function (r) {
      var a = r[0].effective, b = r[1].effective, keys = {};
      Object.keys(a).concat(Object.keys(b)).forEach(function (k) { keys[k] = true; });
      return Object.keys(keys).sort().filter(function (k) { return JSON.stringify(a[k]) !== JSON.stringify(b[k]); })
        .map(function (k) { return { key: k, from: a[k], to: b[k] }; });
    });
  }

  /** Move the station's `Contains` from one project to another, its name rebuilt
   * under the new one, then resolve it (CONFIG_RESOLVER.md §5). */
  function moveStation(station, from, to) {
    return relate(to, station).then(function () { return unrelate(from, station); })
      .then(function () { return renameStation(station.id, to.id); })
      .then(function (saved) { station.key = saved.name; return resolveStations([station]); });
  }

  /** Every timeseries key of the entity, deleted with all its data. */
  function deleteHistory(entity) {
    var base = '/api/plugins/telemetry/' + entity.entityType + '/' + entity.id;
    return get(base + '/keys/timeseries').then(function (keys) {
      if (!keys || !keys.length) { return null; }
      return del(base + '/timeseries/delete', { keys: keys.join(','), deleteAllDataForKeys: 'true' });
    });
  }

  /** ThingsBoard drops the entity's relations with it. */
  function deleteEntity(entity) { return del('/api/' + entityPath(entity) + '/' + entity.id); }

  /** `service.*` of an entity's attributes (ATTRIBUTES.md §4): a silence only while it runs. */
  function serviceOf(attrs) {
    var until = Number(attrs['service.silencedUntil']) || 0;
    return { state: attrs['service.state'] || null, retired: attrs['service.state'] === 'retired',
      silencedUntil: until > Date.now() ? until : null, silencedBy: attrs['service.silencedBy'] || '' };
  }

  /** A service state (ATTRIBUTES.md §4), or null for in service. A device going out of
   * service clears its active alarms: the chains raise none while it is out. */
  function setServiceState(entity, value) {
    if (!value) { return deleteAttrs(entity, ['service.state']); }
    return saveAttrs(entity, { 'service.state': value }).then(function () {
      if (entity.entityType !== 'DEVICE') { return null; }
      return getAll('/api/alarm/DEVICE/' + entity.id, { searchStatus: 'ACTIVE' }).then(function (alarms) {
        return Promise.all(alarms.filter(function (a) { return !a.originator || a.originator.id === entity.id; }).map(clearAlarm));
      });
    });
  }

  function userName(u) { return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || ''; }

  // -- a user's own notification switches (TC-14, ATTRIBUTES.md §4 *Platform user*) ----------------
  // In the profile's additionalInfo: every user may save their own profile, a technician too.
  var SWITCH_KEYS = ['config.notify.enabled', 'config.sms.enabled', 'config.email.enabled'];
  var CONTACT_KEYS = ['config.notify.contacts', 'config.notify.deviceContacts'];

  /** `{key: value}` of the switches `user` set; unset means on. */
  function switchesOf(user) {
    var info = (user && user.additionalInfo) || {}, out = {};
    SWITCH_KEYS.forEach(function (k) { if (k in info) { out[k] = info[k]; } });
    return out;
  }

  /** The levels whose contact lists name user `id`: assets in one query, then customers. */
  function levelsNaming(id) {
    function names(raw) {
      var list = raw;
      if (typeof list === 'string') { try { list = JSON.parse(list); } catch (e) { list = null; } }
      return Array.isArray(list) && list.some(function (c) { return c && c.type === 'user' && c.userId === id; });
    }
    function query(filter, fields) {
      return post('/api/entitiesQuery/find', {
        entityFilter: filter, entityFields: fields.map(function (k) { return { type: 'ENTITY_FIELD', key: k }; }),
        latestValues: CONTACT_KEYS.map(function (k) { return { type: 'SERVER_ATTRIBUTE', key: k }; }),
        pageLink: { page: 0, pageSize: 1000 }
      }).then(function (page) {
        return ((page && page.data) || []).filter(function (e) {
          var a = (e.latest && e.latest.SERVER_ATTRIBUTE) || {};
          return CONTACT_KEYS.some(function (k) { return a[k] && names(a[k].value); });
        }).map(function (e) {
          var f = (e.latest && e.latest.ENTITY_FIELD) || {};
          function v(k) { return f[k] && f[k].value; }
          return { entityType: e.entityId.entityType, id: e.entityId.id, name: v('label') || v('name') || v('title'), key: v('name'), kind: v('type') };
        });
      }).catch(function () { return []; });
    }
    return Promise.all([
      query({ type: 'assetType', assetTypes: ['Defaults', 'Project', 'Location', 'Station'], assetNameFilter: '' }, ['name', 'label', 'type']),
      query({ type: 'entityType', entityType: 'CUSTOMER' }, ['title'])
    ]).then(function (got) { return got[0].concat(got[1]); });
  }

  /** Every station whose contacts name user `id`, once each. */
  function stationsNaming(id) {
    return levelsNaming(id).then(function (levels) {
      return Promise.all(levels.map(function (l) { return resolver.affectedStations(l, io).catch(function () { return []; }); }));
    }).then(function (lists) {
      var seen = {}, out = [];
      lists.forEach(function (list) { (list || []).forEach(function (s) { if (!seen[s.id]) { seen[s.id] = true; out.push(s); } }); });
      return out;
    });
  }

  /** Whether the signed-in user may write the attributes of the stations they see. */
  function mayWriteStations() {
    return Promise.all([currentUser(), permissions()]).then(function (got) {
      if ((got[0] || {}).authority === 'TENANT_ADMIN') { return true; }
      var generic = ((got[1] || {}).userPermissions || {}).genericPermissions || {};
      var ops = (generic.ASSET || []).concat(generic.ALL || []);
      return ops.indexOf('ALL') >= 0 || ops.indexOf('WRITE_ATTRIBUTES') >= 0;
    });
  }

  /** Save the signed-in user's own `switches` in their profile, then re-resolve every station
   * naming them when the user may: `{stations, resolved}`; else the nightly sweep follows. */
  function saveMySwitches(switches) {
    return currentUser().then(function (me) {
      return get('/api/user/' + me.id.id).then(function (user) {
        var info = user.additionalInfo = user.additionalInfo || {};
        SWITCH_KEYS.forEach(function (k) { if (switches[k] === false) { info[k] = false; } else { delete info[k]; } });
        return post('/api/user', user);
      }).then(function () {
        return Promise.all([stationsNaming(me.id.id), mayWriteStations()]);
      }).then(function (got) {
        var stations = got[0];
        if (!got[1] || !stations.length) { return { stations: stations.length, resolved: false }; }
        return resolveStations(stations).then(function () { return { stations: stations.length, resolved: true }; });
      });
    });
  }

  function silence(entity, until) {
    return currentUser().then(function (me) {
      return saveAttrs(entity, { 'service.silencedUntil': until, 'service.silencedBy': userName(me || {}) });
    });
  }

  // Ending early writes now, never deletes: the silence summary keys on it.
  function endSilence(entity) { return saveAttrs(entity, { 'service.silencedUntil': Date.now() }); }

  // A timeseries point per notification withheld during a silence (ATTRIBUTES.md §4): never a reading.
  var SILENCED_NOTICE = 'service.silencedNotice';

  /** `keys` without the service bookkeeping, for any list of a device's or a station's keys. */
  function readingKeys(keys) { return (keys || []).filter(function (k) { return k !== SILENCED_NOTICE; }); }

  function setLabel(device, label) {
    return get('/api/device/' + device.id).then(function (d) { return post('/api/device', Object.assign(d, { label: label })); });
  }

  /** The assets that `Contains` the device, as `assetLevel`s. */
  function deviceParents(device) {
    return get('/api/relations/info', { toId: device.id, toType: 'DEVICE' }).then(function (rels) {
      return Promise.all((rels || []).filter(function (r) { return r.type === 'Contains' && r.from.entityType === 'ASSET'; })
        .map(function (r) { return getAsset(r.from.id).then(assetLevel).catch(function () { return null; }); }));
    }).then(function (parents) { return parents.filter(Boolean); });
  }

  /** Give the device to `owner` (TA-1): its entries leave every station map and
   * its `Contains` relations go, the stations resolve, and only then does the
   * owner change, so it never feeds a station of its previous owner
   * (device_ownership.py). Returns the stations whose map changed. */
  function reassignDevice(device, owner, parents) {
    var changed = [];
    return Promise.all(parents.map(function (parent) {
      return attrsMap(parent).then(function (attrs) {
        var entries = resolver.mapEntries(attrs['config.channelMap']), kept = {};
        Object.keys(entries).forEach(function (c) { if (entries[c].device !== device.id) { kept[c] = entries[c]; } });
        if (Object.keys(kept).length === Object.keys(entries).length) { return null; }
        changed.push(parent);
        return saveAttrs(parent, { 'config.channelMap': resolver.buildMap(kept) });
      }).then(function () { return unrelate(parent, device); });
    })).then(function () { return resolveStations(changed); }).then(function () {
      // PE's owner change takes an optional list of groups as its body: none is sent.
      return toPromise(getService('http').post('/api/owner/' + owner.entityType + '/' + owner.id + '/DEVICE/' + device.id, null));
    }).then(function () { return changed; });
  }

  function ackAlarm(alarm) { return post('/api/alarm/' + alarm.id.id + '/ack'); }
  function clearAlarm(alarm) { return post('/api/alarm/' + alarm.id.id + '/clear'); }

  /** The devices `entity` contains. */
  function containedDevices(entity) {
    return post('/api/relations', {
      parameters: { rootId: entity.id, rootType: entity.entityType, direction: 'FROM', relationTypeGroup: 'COMMON', maxLevel: 1, fetchLastLevelOnly: false },
      filters: [{ relationType: 'Contains', entityTypes: ['DEVICE'] }]
    }).then(function (rels) { return (rels || []).map(function (r) { return { entityType: 'DEVICE', id: r.to.id }; }); });
  }

  /** Make the station's `Contains` relations to devices follow its map entries. */
  function relateToMap(station, entries) {
    var wanted = resolver.mapDevices(entries);
    return containedDevices(station).then(function (current) {
      var ids = current.map(function (d) { return d.id; });
      return Promise.all(wanted.filter(function (d) { return ids.indexOf(d) < 0; }).map(function (d) { return relate(station, { entityType: 'DEVICE', id: d }); })
        .concat(current.filter(function (d) { return wanted.indexOf(d.id) < 0; }).map(function (d) { return unrelate(station, d); })));
    });
  }

  /** The Stations that contain the device, by name, each with its `project`
   * or null. Only a Station feeds from a device: another asset that contains
   * it is left out. `projectOf` caches a station's project across calls. */
  function deviceStations(device, projectOf) {
    projectOf = projectOf || {};
    return post('/api/relations', {
      parameters: { rootId: device.id, rootType: 'DEVICE', direction: 'TO', relationTypeGroup: 'COMMON', maxLevel: 1, fetchLastLevelOnly: false },
      filters: [{ relationType: 'Contains', entityTypes: ['ASSET'] }]
    }).then(function (rels) {
      return Promise.all((rels || []).map(function (r) { return getAsset(r.from.id).catch(function () { return null; }); }));
    }).then(function (assets) {
      var stations = assets.filter(function (a) { return a && a.type === 'Station'; }).map(function (a) {
        var s = assetLevel(a);
        s.ownerId = a.ownerId && a.ownerId.id;
        return s;
      }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      return Promise.all(stations.map(function (s) {
        var p = projectOf[s.id] || (projectOf[s.id] = ancestors(s).then(function (chain) {
          return chain.filter(function (a) { return a.kind === 'Project'; })[0] || null;
        }));
        return p.then(function (project) { s.project = project; });
      })).then(function () { return stations; });
    });
  }

  /** The device's latest `p0.gnssFix`, `{lat, lon, sats, ts}`, or null. */
  function latestFix(deviceId) {
    return get('/api/plugins/telemetry/DEVICE/' + deviceId + '/values/timeseries', { keys: 'p0.gnssFix' }).then(function (r) {
      var p = r && r['p0.gnssFix'] && r['p0.gnssFix'][0];
      var fix = p && p.value && (typeof p.value === 'string' ? JSON.parse(p.value) : p.value);
      return fix && isFinite(Number(fix.lat)) && isFinite(Number(fix.lon))
        ? { lat: Number(fix.lat), lon: Number(fix.lon), sats: fix.sats, ts: Number(p.ts) } : null;
    }).catch(function () { return null; });
  }

  /** Live updates of the entity's attributes in `scopes` and of its latest telemetry, every key, on
   * ThingsBoard's own websocket. `onChange` runs on each update after the initial snapshots, and once
   * after a reconnect. Returns `{healthy, close}`: healthy once every snapshot arrived. */
  function watch(entity, scopes, onChange) {
    var ws = getService('telemetryWsService');
    var cmds = scopes.map(function (scope) { return { type: 'ATTRIBUTES', entityType: entity.entityType, entityId: entity.id, scope: scope }; })
      .concat([{ type: 'TIMESERIES', entityType: entity.entityType, entityId: entity.id, scope: 'LATEST_TELEMETRY' }]);
    var seen = {}, closed = false;
    var subscriber = {
      subscriptionCommands: cmds,
      onData: function (update) {
        if (closed) { return; }
        if (!seen[update.subscriptionId]) { seen[update.subscriptionId] = true; return; }
        onChange();
      },
      onReconnected: function () { seen = {}; if (!closed) { onChange(); } }
    };
    ws.subscribe(subscriber);
    return {
      healthy: function () { return !closed && cmds.every(function (c) { return seen[c.cmdId]; }); },
      close: function () {
        if (closed) { return; }
        closed = true;
        // The service sends an unsubscribe only for its own command classes.
        var queue = ws.cmdWrapper && ws.cmdWrapper.cmds;
        if (queue) { cmds.forEach(function (c) { queue.push(Object.assign({}, c, { unsubscribe: true })); }); }
        ws.unsubscribe(subscriber);
      }
    };
  }

  return {
    io: io, get: get, getAll: getAll, post: post, del: del, attrsMap: attrsMap, saveAttrs: saveAttrs, deleteAttrs: deleteAttrs,
    watch: watch,
    getAsset: getAsset, assetLevel: assetLevel, deviceLevel: deviceLevel, boundDatasource: boundDatasource, loadEntity: loadEntity,
    currentUser: currentUser, canWrite: canWrite, listUsers: listUsers, resolveStations: resolveStations,
    channelFreshness: channelFreshness,
    isComplexDevice: isComplexDevice,
    ancestors: ancestors, openDashboard: openDashboard, openProject: openProject, openStation: openStation, readableDashboard: readableDashboard, isPublicView: isPublicView,
    publicLink: publicLink, ownerOf: ownerOf, relabel: relabel, sameLabel: sameLabel, publicMembers: publicMembers, setPublic: setPublic, namedGroup: namedGroup,
    relate: relate, unrelate: unrelate, createStation: createStation, createProject: createProject, ownerProjects: ownerProjects,
    settingChanges: settingChanges, moveStation: moveStation, deleteHistory: deleteHistory, deleteEntity: deleteEntity,
    serviceOf: serviceOf, setServiceState: setServiceState, silence: silence, endSilence: endSilence,
    ackAlarm: ackAlarm, clearAlarm: clearAlarm, containedDevices: containedDevices, relateToMap: relateToMap, deviceStations: deviceStations,
    latestFix: latestFix, userName: userName, switchesOf: switchesOf, saveMySwitches: saveMySwitches, stationsNaming: stationsNaming,
    SILENCED_NOTICE: SILENCED_NOTICE, readingKeys: readingKeys, setLabel: setLabel, deviceParents: deviceParents,
    reassignDevice: reassignDevice
  };
};

})(typeof self !== 'undefined' ? self : this);
