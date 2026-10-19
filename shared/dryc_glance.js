/*
 * terrySense DRYC inputs at a glance — `window.TerrySenseDrycGlance(latest, prefix, inputs)`
 * draws a DRYC's 8 inputs as a row of circles, input 1 on the left: filled when
 * on, empty when off, dashed with no reading yet; the status's age beside it
 * (logr-product-docs/cloud/DRYC.md §8). `latest` maps `<prefix>drycInput<n>` to
 * `{ts, value}`; `inputs` is the station's `dryc.rules` inputs, whose label and
 * level wording show on hover. Returns the row, or null with no input read.
 * Styles: shared/theme.css.
 */
(function (root) {
'use strict';

var INPUTS = 8;

function truthy(v) { return v === true || v === 1 || v === '1' || v === 'true'; }

root.TerrySenseDrycGlance = function (latest, prefix, inputs) {
  var t = root.TerrySenseT, ts = 0, read = 0;
  var row = document.createElement('span');
  row.className = 'ts-dryc-glance';
  var dots = row.appendChild(document.createElement('span'));
  dots.className = 'ts-dryc-ins';
  for (var i = 1; i <= INPUTS; i++) {
    var v = (latest || {})[prefix + 'drycInput' + i], x = (inputs || [])[i - 1] || {};
    var dot = dots.appendChild(document.createElement('span'));
    var name = x.label || t('drycGlance.input', 'Input {n}', { n: i });
    dot.className = 'ts-dryc-in';
    dot.setAttribute('data-input', i);
    if (!v) {
      dot.setAttribute('data-s', 'none');
      dot.title = t('drycGlance.noReading', '{name}: no reading yet', { name: name });
      continue;
    }
    read++;
    ts = Math.max(ts, Number(v.ts) || 0);
    var on = truthy(v.value);
    dot.setAttribute('data-s', on ? 'on' : 'off');
    dot.title = t('drycGlance.level', '{name}: {level}', { name: name, level: on ? (x.whenOn || t('common.on', 'On')) : (x.whenOff || t('common.off', 'Off')) });
  }
  if (!read) { return null; }
  row.setAttribute('data-on', [].map.call(dots.querySelectorAll('[data-s=on]'), function (d) { return d.getAttribute('data-input'); }).join(','));
  var age = row.appendChild(document.createElement('span'));
  age.className = 'ts-dryc-age';
  age.textContent = t.ago(ts);
  return row;
};

})(typeof self !== 'undefined' ? self : this);
