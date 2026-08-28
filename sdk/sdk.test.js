'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { defineHook, fakeCard, fakeCtx, fakePluginContext } = require('./index.js');

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
