'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { defineHook, fakeCard, fakeCtx, fakePluginContext, declaredDefaults } = require('./index.js');

test('defineHook is identity', () => {
  const fn = (ctx) => ctx.pass();
  assert.strictEqual(defineHook(fn), fn);
});

test('fakeCard has the scanner card shape and takes overrides', () => {
  const card = fakeCard({ state: 'review', title: 'My card' });
  for (const key of ['path', 'slug', 'state', 'project', 'title']) {
    assert.ok(key in card, `missing ${key}`);
  }
  assert.strictEqual(card.state, 'review');
  assert.strictEqual(card.title, 'My card');
});

test('fakeCtx records pass/block/amend verdicts', async () => {
  const ctx = fakeCtx({ from: 'doing', to: 'review' });
  assert.deepStrictEqual(ctx.verdict, { kind: 'pass' });
  assert.strictEqual(ctx.hook, 'before:review');

  await defineHook((c) => c.block({ reason: 'no plan', fix: 'write one' }))(ctx);
  assert.deepStrictEqual(ctx.verdict, { kind: 'block', reason: 'no plan', fix: 'write one' });

  ctx.amend({ sections: { Notes: 'hello' } });
  assert.deepStrictEqual(ctx.verdict, { kind: 'amend', sections: { Notes: 'hello' } });

  ctx.pass();
  assert.deepStrictEqual(ctx.verdict, { kind: 'pass' });
});

test('fakeCtx block defaults match the engine (reason "blocked", fix "")', () => {
  const ctx = fakeCtx();
  ctx.block();
  assert.deepStrictEqual(ctx.verdict, { kind: 'block', reason: 'blocked', fix: '' });
});

test('fakePluginContext records registrations and enforces the manifest', () => {
  const manifest = { id: 'p', version: '0.1.0', hooks: ['before:review'], points: ['theme.register'] };
  const ctx = fakePluginContext(manifest);

  const fn = defineHook((c) => c.pass());
  const off = ctx.hooks.on('before:review', fn);
  ctx.contribute('theme.register', [{ id: 'x', label: 'X' }]);
  assert.deepStrictEqual(ctx.hookRegistrations, [{ name: 'before:review', fn }]);
  assert.deepStrictEqual(ctx.contributions, [{ point: 'theme.register', payload: [{ id: 'x', label: 'X' }] }]);

  assert.throws(() => ctx.hooks.on('after:doing', fn), /not declared/);
  assert.throws(() => ctx.contribute('sdlc.workflow', {}), /not declared/);

  off();
  assert.strictEqual(ctx.hookRegistrations.length, 0);
});

// --- settings on the fake context -----------------------------------------

test('declaredDefaults reads the value-bearing settings and skips the rest', () => {
  assert.deepStrictEqual(declaredDefaults({
    configuration: {
      a: { type: 'bool', default: true },
      b: { type: 'enum', options: ['p', 'q'] },
      c: { type: 'string' },
      d: { type: 'number' },
      e: { type: 'string[]' },
      f: { type: 'page', default: 'go' },     // a link holds nothing
      g: { type: 'map', default: 'x' },       // no control for it, so no value
      h: 'not-an-object',
    },
  }), { a: true, b: 'p', c: '', d: 0, e: [] });
  assert.deepStrictEqual(declaredDefaults({}), {});
  assert.deepStrictEqual(declaredDefaults({ configuration: [] }), {});
  assert.deepStrictEqual(declaredDefaults(null), {});
});

test('fakePluginContext seeds ctx.settings from the manifest, and values override', () => {
  const manifest = {
    id: 'dev.example.thing',
    hooks: [],
    points: [],
    configuration: { label: { type: 'string', default: 'declared' }, flag: { type: 'bool', default: true } },
  };
  assert.deepStrictEqual(fakePluginContext(manifest).settings, { label: 'declared', flag: true });
  assert.deepStrictEqual(fakePluginContext(manifest, { flag: false }).settings, { label: 'declared', flag: false });
  // frozen, like the host's — a plugin that writes to it is not changing
  // anything the host will ever read back
  assert.throws(() => { fakePluginContext(manifest).settings.label = 'x'; }, TypeError);
});
