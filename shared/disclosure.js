/*
 * terrySense disclosure — `window.TerrySenseDisclosure(widget)` remembers which
 * closed parts of a widget its reader opened, per user (FRONTEND.md
 * *Interface conventions*, Disclosure). `user(id)` names the reader once known;
 * `bind(details, place, open)` opens a `<details>` as that reader last left it,
 * else as `open`; `get` and `set` hold any other on/off place, such as a switch.
 *
 * Kept in the browser's localStorage; where it is refused, for the page's life.
 */
(function (root) {
'use strict';

var PREFIX = 'terrysense.open.';

function read(key) {
  try { return JSON.parse(root.localStorage.getItem(key) || '{}') || {}; } catch (e) { return {}; }
}

function write(key, value) {
  try { root.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* page life only */ }
}

root.TerrySenseDisclosure = function (widget) {
  var key = null, places = {};

  function get(place, dflt) { return places[place] !== undefined ? places[place] : !!dflt; }

  function set(place, on) {
    if (places[place] === on) { return; }
    places[place] = on;
    if (key) { write(key, places); }
  }

  return {
    user: function (id) {
      key = PREFIX + widget + '.' + (id || 'anyone');
      places = Object.assign(read(key), places);
    },
    get: get,
    set: set,
    bind: function (el, place, dflt) {
      el.open = get(place, dflt);
      el.addEventListener('toggle', function () { set(place, el.open); });
      return el;
    }
  };
};

})(typeof self !== 'undefined' ? self : this);
