'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { fakePluginContext } = require('../../sdk/index.js');
const manifest = require('./grid-plugin.json');
const plugin = require('./index.js');

test('manifest parses and matches the design roster', () => {
  assert.match(manifest.id, /^[a-z0-9][a-z0-9-]*$/);
  assert.strictEqual(manifest.id, 'claude-provider');
  assert.strictEqual(manifest.version, '0.1.0');
  assert.strictEqual(manifest.publisher, 'grid console');
  assert.deepStrictEqual(manifest.points, ['agent.provider', 'llm.provider']);
  assert.deepStrictEqual(manifest.hooks, []);
  assert.strictEqual(manifest.settings.length, 9);
  assert.deepStrictEqual(manifest.settings[0], ['commands.prepare', 'string', 'claude /prepare {card.md}']);
});

test('activate contributes the Claude agent provider descriptor', () => {
  const ctx = fakePluginContext(manifest);
  plugin.activate(ctx);
  assert.deepStrictEqual(ctx.contributions.map((c) => c.point), ['agent.provider']);
  const p = ctx.contributions[0].payload;
  assert.strictEqual(p.id, 'claude');
  assert.strictEqual(p.name, 'Claude (Claude Code)');
  assert.strictEqual(p.bin, 'claude');
  assert.deepStrictEqual(p.commands, [
    { name: '/prepare', file: '.claude/commands/prepare.md', usedBy: 'inbox -> prepare' },
    { name: '/build', file: '.claude/commands/build.md', usedBy: 'prepare -> doing' },
    { name: '/self-review', file: '.claude/commands/self-review.md', usedBy: 'doing -> review' },
  ]);
  assert.strictEqual(ctx.hookRegistrations.length, 0);
});
