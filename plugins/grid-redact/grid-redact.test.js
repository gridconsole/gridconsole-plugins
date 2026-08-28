'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { fakePluginContext } = require('../../sdk/index.js');
const manifest = require('./grid-plugin.json');
const plugin = require('./index.js');

test('manifest parses and matches the design roster', () => {
  assert.match(manifest.id, /^[a-z0-9][a-z0-9-]*$/);
  assert.strictEqual(manifest.id, 'grid-redact');
  assert.strictEqual(manifest.version, '0.1.0');
  assert.strictEqual(manifest.publisher, 'grid console');
  assert.deepStrictEqual(manifest.points, ['report.redactor']);
  assert.deepStrictEqual(manifest.hooks, []);
  // The manifest's `configuration` block, verbatim — what the host parses
  // into descriptors and the Plugins pane draws a control from.
  assert.deepStrictEqual(manifest.configuration, {
    "rules": {"type": "path", "title": "Rules file", "default": "<config>/redact.toml"},
    "redactFileNames": {"type": "bool", "title": "Redact file names", "default": true},
    "keepStackTraces": {"type": "bool", "title": "Keep stack traces", "default": true}
  });
  assert.strictEqual(manifest.settings, undefined, 'the Phase 2 triple is gone');
});

test('activate contributes the report.redactor ownership stub', () => {
  const ctx = fakePluginContext(manifest);
  plugin.activate(ctx);
  assert.deepStrictEqual(ctx.contributions, [{
    point: 'report.redactor',
    payload: { id: 'grid-redact', description: manifest.description },
  }]);
  assert.strictEqual(ctx.hookRegistrations.length, 0);
});
