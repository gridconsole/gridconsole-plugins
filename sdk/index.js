'use strict';
// Test helpers for Grid Console plugins. The runtime contract lives in the
// host (gridconsole-core: ide/engine/pluginhost.js + transition.js); these
// helpers mirror its ctx semantics closely enough that a hook or an
// activate() can be unit-tested without the engine.

/**
 * The defaults a manifest declares, by key — the value-bearing settings only.
 *
 * A local reading of `configuration` rather than a call into the host: the SDK
 * ships to plugin authors and cannot depend on gridconsole-core. It is
 * deliberately the tolerant half of the host's rule — enough to seed a test
 * context, not a validator. The host is what refuses a bad manifest.
 */
const SETTING_VALUE_TYPES = ['bool', 'string', 'number', 'enum', 'string[]', 'path'];

function declaredDefaults(manifest) {
  const out = {};
  const cfg = manifest && manifest.configuration;
  if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) {
    for (const [key, spec] of Object.entries(cfg)) {
      if (!spec || typeof spec !== 'object') continue;
      if (!SETTING_VALUE_TYPES.includes(spec.type)) continue;
      if (spec.default !== undefined) out[key] = spec.default;
      else if (spec.type === 'enum') out[key] = (spec.options || [])[0];
      else if (spec.type === 'bool') out[key] = false;
      else if (spec.type === 'number') out[key] = 0;
      else if (spec.type === 'string[]') out[key] = [];
      else out[key] = '';
    }
  }
  return out;
}

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
 *
 * `values` stands in for what the host resolved from the workspace. It is
 * merged over the manifest's declared defaults, so a test that passes nothing
 * gets exactly what a fresh workspace would give the plugin, and a test that
 * passes one key overrides only that one.
 */
function fakePluginContext(manifest, values = {}) {
  const ctx = {
    id: manifest.id,
    manifest,
    settings: Object.freeze({ ...declaredDefaults(manifest), ...values }),
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
    commands: {
      register(name, fn) {
        if (!(manifest.commands || []).includes(name)) {
          throw new Error(`command ${name} not declared in grid-plugin.json`);
        }
        if (typeof fn !== 'function') throw new Error('command must be a function');
        ctx.commandRegistrations.set(name, fn);
        return () => ctx.commandRegistrations.delete(name);
      },
    },
    contribute(point, payload) {
      if (!(manifest.points || []).includes(point)) {
        throw new Error(`contribution point ${point} not declared in grid-plugin.json`);
      }
      ctx.contributions.push({ point, payload });
    },
    /** Call a registered command the way the host's `invoke` would — by name,
     *  with plain args in and a plain answer out. */
    invoke(name, args = {}) {
      const fn = ctx.commandRegistrations.get(name);
      if (!fn) throw new Error(`no command ${name}`);
      return fn(args);
    },
  };
  ctx.commandRegistrations = new Map();
  return ctx;
}

module.exports = { defineHook, fakeCard, fakeCtx, fakePluginContext, declaredDefaults };
