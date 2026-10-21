/*
 * The generated names of projects and stations — `window.TerrySenseNaming`.
 * The label is what users read; the name is built from it, unique across the
 * tenant. Rule: logr-product-docs/cloud/ENTITY_MODEL.md *Names and labels*;
 * terrysense/operations/naming.py builds the same names, both checked against
 * tests/fixtures/naming_cases.json.
 */
(function (root) {
'use strict';

var SLUG_MAX = 24;
var CUT_WINDOW = 8;
var TENANT_CODE = 'interra';
var CODE = /^[a-z0-9]{1,8}$/;
var FOLD = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss', 'œ': 'oe', 'æ': 'ae' };

function cut(s, max) {
  if (s.length <= max) { return s; }
  var head = s.slice(0, max), dash = head.lastIndexOf('-');
  return (dash >= max - CUT_WINDOW ? head.slice(0, dash) : head).replace(/-+$/, '');
}

/** The label as one level of a name; `fallback` when nothing of it is left. */
function slug(label, fallback) {
  var s = String(label || '').toLowerCase().replace(/[äöüßœæ]/g, function (c) { return FOLD[c]; })
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cut(s, SLUG_MAX) || fallback;
}

/** `s` with the `n`th suffix, `-2` from the second on, within the slug length. */
function suffixed(s, n) {
  if (n < 2) { return s; }
  var tail = '-' + n;
  return cut(s, SLUG_MAX - tail.length) + tail;
}

function projectName(code, label, n) { return code + '_' + suffixed(slug(label, 'project'), n || 1); }

function stationName(projectNameValue, label, n) { return projectNameValue + '_' + suffixed(slug(label, 'station'), n || 1); }

function validCode(code) { return CODE.test(String(code || '')); }

var api = { slug: slug, projectName: projectName, stationName: stationName, validCode: validCode, TENANT_CODE: TENANT_CODE, SLUG_MAX: SLUG_MAX };
root.TerrySenseNaming = api;

if (typeof module !== 'undefined' && module.exports) { module.exports = api; }

})(typeof window !== 'undefined' ? window : globalThis);
