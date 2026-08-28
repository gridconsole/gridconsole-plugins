'use strict';
// Test helpers for Grid Console plugins. The runtime contract lives in the
// host (gridconsole-core: ide/engine/pluginhost.js + transition.js); these
// helpers mirror its ctx semantics closely enough that a hook or an
// activate() can be unit-tested without the engine.

/** Identity — exists so a hook picks up the HookFn type in editors. */
function defineHook(fn) {
  return fn;
}

/** A card shaped like the engine's scanner cards. */
function fakeCard(overrides = {}) {
  return {
    path: '/workspace/thoughts/projects/demo/plans/2026-01-01_fake-card.md',
    slug: 'demo-fake-card',
    state: 'inbox',
    project: 'demo',
    title: 'Fake card',
    ...overrides,
  };
}

/**
 * A hook ctx whose pass/block/amend record their verdict on ctx.verdict.
 * Defaults and string coercion match transition.js so an assertion written
 * against this helper holds against the real thing.
 *
 * `body` and `frontmatter` are the card's content, which the host reads off
 * disk lazily; here you hand them in directly, so a contract hook is testable
 * without a file. Both default to empty, like the host's fallback for a card
 * it cannot read.
 *
 * They are set in BOTH places the two hosts put them — on the card (what a
 * sandboxed plugin receives across the process boundary) and at the top level
 * (what an in-process plugin receives from the engine ctx) — so a hook that
 * reads either shape passes here and in production. Read both in your hook;
 * which one you get depends on how the host loaded you, not on your code.
 */
function fakeCtx(opts = {}) {
  const to = opts.to || 'prepare';
  const body = opts.body !== undefined ? String(opts.body) : '';
  const frontmatter = opts.frontmatter || {};
  const ctx = {
    card: { ...(opts.card || fakeCard()), body, frontmatter },
    from: opts.from !== undefined ? opts.from : 'inbox',
    to,
    reason: String(opts.reason || ''),
    observed: !!opts.observed,
    hook: opts.hook || `before:${to}`,
    plugin: opts.plugin || 'test',
    body,
    frontmatter,
    verdict: { kind: 'pass' },
    pass() { ctx.verdict = { kind: 'pass' }; },
    block(o = {}) { ctx.verdict = { kind: 'block', reason: String(o.reason || 'blocked'), fix: o.fix ? String(o.fix) : '' }; },
    amend(o = {}) { ctx.verdict = { kind: 'amend', sections: o.sections || {} }; },
  };
  return ctx;
}

/**
 * A PluginContext that records registrations instead of wiring them, while
 * enforcing the host's declared-in-manifest rules — so a test catches an
 * undeclared hook or point the same way activation would.
 */
function fakePluginContext(manifest) {
  const ctx = {
    id: manifest.id,
    manifest,
    contributions: [],
    hookRegistrations: [],
    logged: [],
    log(msg) { ctx.logged.push(String(msg)); },
    hooks: {
      on(name, fn) {
        if (!(manifest.hooks || []).includes(name)) {
          throw new Error(`hook ${name} not declared in grid-plugin.json`);
        }
        const rec = { name, fn };
        ctx.hookRegistrations.push(rec);
        return () => {
          const i = ctx.hookRegistrations.indexOf(rec);
          if (i !== -1) ctx.hookRegistrations.splice(i, 1);
        };
      },
    },
    contribute(point, payload) {
      if (!(manifest.points || []).includes(point)) {
        throw new Error(`contribution point ${point} not declared in grid-plugin.json`);
      }
      ctx.contributions.push({ point, payload });
    },
  };
  return ctx;
}

module.exports = { defineHook, fakeCard, fakeCtx, fakePluginContext };
