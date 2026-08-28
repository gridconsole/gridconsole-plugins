'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { fakePluginContext } = require('../../sdk/index.js');
const manifest = require('./grid-plugin.json');
const plugin = require('./index.js');

test('manifest parses and matches the design roster', () => {
  assert.match(manifest.id, /^[a-z0-9][a-z0-9-]*$/);
  assert.strictEqual(manifest.id, 'grid-themes');
  assert.strictEqual(manifest.version, '0.1.0');
  assert.strictEqual(manifest.publisher, 'grid console');
  assert.deepStrictEqual(manifest.points, ['theme.register']);
  assert.deepStrictEqual(manifest.hooks, []);
  // The manifest's `configuration` block, verbatim — what the host parses
  // into descriptors and the Plugins pane draws a control from.
  assert.deepStrictEqual(manifest.configuration, {
    "default": {"type": "enum", "title": "Default theme", "default": "grid", "options": ["grid", "dusk", "light", "hc"]},
    "followSystem": {"type": "bool", "title": "Follow system appearance", "default": false}
  });
  assert.strictEqual(manifest.settings, undefined, 'the Phase 2 triple is gone');
});

test('activate contributes the four themes, ids per theme.ts, labels per the design', () => {
  const ctx = fakePluginContext(manifest);
  plugin.activate(ctx);
  assert.deepStrictEqual(ctx.contributions, [{
    point: 'theme.register',
    payload: [
      { id: 'grid', label: 'Grid dark' },
      { id: 'dusk', label: 'Dusk' },
      { id: 'light', label: 'Grid light' },
      { id: 'hc', label: 'High contrast' },
    ],
  }]);
  assert.strictEqual(ctx.hookRegistrations.length, 0);
});
