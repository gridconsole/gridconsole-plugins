'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { fakePluginContext } = require('../../sdk/index.js');
const manifest = require('./grid-plugin.json');
const plugin = require('./index.js');

test('manifest declares the Codex provider and its configuration', () => {
  assert.strictEqual(manifest.id, 'codex-provider');
  assert.strictEqual(manifest.version, '0.1.0');
  assert.deepStrictEqual(manifest.points, ['agent.provider', 'llm.provider']);
  assert.strictEqual(manifest.configuration.defaultModel.type, 'string');
  assert.strictEqual(manifest.configuration.sandbox.default, 'workspace-write');
  assert.deepStrictEqual(manifest.configuration.sandbox.options,
    ['read-only', 'workspace-write', 'danger-full-access']);
});

test('activate contributes a Codex CLI provider descriptor', () => {
  const ctx = fakePluginContext(manifest);
  plugin.activate(ctx);
  assert.deepStrictEqual(ctx.contributions.map((c) => c.point), ['agent.provider']);
  const provider = ctx.contributions[0].payload;
  assert.strictEqual(provider.id, 'codex');
  assert.strictEqual(provider.bin, 'codex');
  assert.deepStrictEqual(provider.capabilities,
    { nonInteractive: true, jsonl: true, resume: true, chat: 'experimental', terminal: true });
  assert.strictEqual(provider.interactive.mode, 'terminal');
  assert.deepStrictEqual(provider.invocation.run,
    ['exec', '--json', '--sandbox', 'workspace-write', '-']);
  assert.deepStrictEqual(provider.invocation.resume,
    ['exec', 'resume', '{sessionId}', '-']);
  assert.deepStrictEqual(provider.commands.map((command) => command.name),
    ['/prepare', '/build', '/self-review']);
  assert.strictEqual(ctx.hookRegistrations.length, 0);
});
