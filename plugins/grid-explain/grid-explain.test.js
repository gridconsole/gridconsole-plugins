'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { fakePluginContext } = require('../../sdk/index.js');
const manifest = require('./grid-plugin.json');
const plugin = require('./index.js');

test('manifest parses and matches the design roster', () => {
  assert.match(manifest.id, /^[a-z0-9][a-z0-9-]*$/);
  assert.strictEqual(manifest.id, 'grid-explain');
  assert.strictEqual(manifest.version, '0.1.0');
  assert.strictEqual(manifest.publisher, 'grid console');
  assert.deepStrictEqual(manifest.points, ['file.explain', 'editor.contextMenu', 'keymap.command']);
  assert.deepStrictEqual(manifest.commands, ['grid-explain:describe-selection']);
  assert.deepStrictEqual(manifest.hooks, []);
  // The manifest's `configuration` block, verbatim — what the host parses
  // into descriptors and the Plugins pane draws a control from.
  assert.deepStrictEqual(manifest.configuration, {
    "model": {"type": "enum", "title": "Summary model", "default": "haiku", "options": ["fable", "opus", "sonnet", "haiku"]},
    "inlineNotes": {"type": "bool", "title": "Inline notes", "default": true},
    "refreshOn": {"type": "enum", "title": "Refresh on", "default": "file change", "options": ["file change", "save", "manual"]}
  });
  assert.strictEqual(manifest.settings, undefined, 'the Phase 2 triple is gone');
});

test('activate contributes the file.explain ownership stub', () => {
  const ctx = fakePluginContext(manifest);
  plugin.activate(ctx);
  assert.deepStrictEqual(ctx.contributions[0], {
    point: 'file.explain',
    payload: { id: 'grid-explain', description: manifest.description },
  });
  assert.strictEqual(ctx.hookRegistrations.length, 0);
});

test('activate contributes a menu row and a keymap row for the same command', () => {
  const ctx = fakePluginContext(manifest);
  plugin.activate(ctx);
  assert.deepStrictEqual(ctx.contributions.map((c) => c.point),
    ['file.explain', 'editor.contextMenu', 'keymap.command']);
  const menu = ctx.contributions[1].payload;
  const keys = ctx.contributions[2].payload;
  assert.deepStrictEqual(menu, [{
    command: 'grid-explain:describe-selection', label: '✦ Describe this selection', when: 'selection',
  }]);
  // No accelerator: a contributed command arrives unbound and the operator
  // gives it a key, so it can never quietly claim a chord Grid answers.
  assert.strictEqual('accel' in keys[0], false);
  assert.strictEqual(keys[0].command, menu[0].command);
  // Both rows name a command this plugin actually registered.
  assert.ok(ctx.commandRegistrations.has(menu[0].command));
});

test('the command answers with the span, the symbol and the configured model', () => {
  const ctx = fakePluginContext(manifest);
  plugin.activate(ctx);
  const r = ctx.invoke('grid-explain:describe-selection', {
    rel: 'src/app.ts', line: 12,
    selection: 'export function widen(a) {\n  return a + 1;\n}',
  });
  assert.match(r.note, /lines 12–14 of src\/app\.ts/);
  assert.match(r.note, /around `widen`/);
  assert.match(r.note, /would summarise with haiku, inline notes on/);
  assert.strictEqual(r.lines, 3);
  assert.strictEqual(r.symbol, 'widen');
});

test('the answer follows the workspace settings, which is the whole demonstration', () => {
  const ctx = fakePluginContext(manifest, { model: 'opus', inlineNotes: false });
  plugin.activate(ctx);
  const r = ctx.invoke('grid-explain:describe-selection', { rel: 'a.js', line: 1, selection: 'const x = 1;' });
  assert.match(r.note, /would summarise with opus, inline notes off/);
  assert.strictEqual(r.model, 'opus');
  assert.strictEqual(r.inlineNotes, false);
});

test('an empty selection says so rather than describing nothing', () => {
  const ctx = fakePluginContext(manifest);
  plugin.activate(ctx);
  assert.deepStrictEqual(ctx.invoke('grid-explain:describe-selection', { rel: 'a.js', selection: '' }),
    { note: 'nothing is selected — select some lines and try again' });
});

test('one line stays singular, and an unrecognisable selection names no symbol', () => {
  const ctx = fakePluginContext(manifest);
  plugin.activate(ctx);
  const r = ctx.invoke('grid-explain:describe-selection', { rel: '', line: 9, selection: 'a + b' });
  assert.match(r.note, /^line 9 — 5 chars, 1 line/);
  assert.strictEqual(r.symbol, '');
});
