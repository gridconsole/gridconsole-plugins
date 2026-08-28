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
  // The manifest's `configuration` block, verbatim — what the host parses
  // into descriptors and the Plugins pane draws a control from.
  assert.deepStrictEqual(manifest.configuration, {
    "mode": {"type": "enum", "title": "Deliver as", "default": "pull request", "options": ["pull request", "direct push"]},
    "draft": {"type": "bool", "title": "Open as draft", "default": false},
    "reviewers": {"type": "string[]", "title": "Reviewers — empty means from CODEOWNERS", "default": []},
    "titleFrom": {"type": "enum", "title": "PR title from", "default": "card summary", "options": ["card summary", "branch name", "first commit"]}
  });
  assert.strictEqual(manifest.settings, undefined, 'the Phase 2 triple is gone');
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
