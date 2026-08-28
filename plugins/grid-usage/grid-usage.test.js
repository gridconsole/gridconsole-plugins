'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { fakePluginContext } = require('../../sdk/index.js');
const manifest = require('./grid-plugin.json');
const plugin = require('./index.js');

test('manifest parses and matches the design roster', () => {
  assert.match(manifest.id, /^[a-z0-9][a-z0-9-]*$/);
  assert.strictEqual(manifest.id, 'grid-usage');
  assert.strictEqual(manifest.version, '0.1.0');
  assert.strictEqual(manifest.publisher, 'grid console');
  assert.deepStrictEqual(manifest.points, ['usage.reporter']);
  assert.deepStrictEqual(manifest.hooks, []);
  assert.deepStrictEqual(manifest.settings, [
    ['currency', 'enum', 'EUR'],
    ['warnAt', 'number', '80% of plan week'],
  ]);
});

test('activate contributes the usage.reporter ownership stub', () => {
  const ctx = fakePluginContext(manifest);
  plugin.activate(ctx);
  assert.deepStrictEqual(ctx.contributions, [{
    point: 'usage.reporter',
    payload: { id: 'grid-usage', description: manifest.description },
  }]);
  assert.strictEqual(ctx.hookRegistrations.length, 0);
});
