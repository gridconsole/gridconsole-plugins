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
  assert.deepStrictEqual(manifest.settings, [
    ['default', 'enum', 'Grid dark'],
    ['followSystem', 'bool', 'false'],
  ]);
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
