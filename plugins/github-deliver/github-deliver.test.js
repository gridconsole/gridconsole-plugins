'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { fakePluginContext } = require('../../sdk/index.js');
const manifest = require('./grid-plugin.json');
const plugin = require('./index.js');

test('manifest parses and matches the design roster', () => {
  assert.match(manifest.id, /^[a-z0-9][a-z0-9-]*$/);
  assert.strictEqual(manifest.id, 'github-deliver');
  assert.strictEqual(manifest.version, '0.1.0');
  assert.strictEqual(manifest.publisher, 'grid console');
  assert.deepStrictEqual(manifest.points, ['deliver.target']);
  assert.deepStrictEqual(manifest.hooks, []);
  assert.strictEqual(manifest.settings.length, 4);
});

test('activate contributes the GitHub deliver target', () => {
  const ctx = fakePluginContext(manifest);
  plugin.activate(ctx);
  assert.deepStrictEqual(ctx.contributions, [{
    point: 'deliver.target',
    payload: { id: 'github', name: 'GitHub', action: 'git commit && gh pr create --fill' },
  }]);
  assert.strictEqual(ctx.hookRegistrations.length, 0);
});
