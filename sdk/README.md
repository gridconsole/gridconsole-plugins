# @gridconsole/plugin

The SDK for Grid Console plugins: type definitions for the plugin contract —
the `grid-plugin.json` manifest shape, the stage-transition hooks
(`before:`/`after:` an arrow, plus `on:attention`, resolved with `ctx.pass()`,
`ctx.block({reason, fix})` or `ctx.amend({sections})`), the `activate(context)`
plugin context, and the payload shapes for the contribution points the bundled
plugins register — including `agent.provider`'s `prompts` array and the
`permissions.spawn` contract that lets a plugin bring its own coding agent.

The contract is documented in the Grid Console docs (Plugins section). Those
chapters are normative; this package tracks them.

## Writing an agent provider

`plugins/copilot-provider/` in this repo is the closest thing to a worked
example for a new provider: its `grid-plugin.json` declares a real, accepted
`permissions.spawn` block (see `PluginSpawn` in `types.d.ts`), and its
`index.js` shows the `agent.provider` contribution — `prompts` (one entry
per stage, `AgentPromptEntry`) plus `spawn: true`, which tells the host
"start me the way my manifest says" rather than restating the spawn
description a second, unsigned time.

## Test helpers

`index.js` ships four helpers so a hook or a plugin's `activate()` can be
unit-tested without the engine:

- `defineHook(fn)` — identity with a type; gives the hook function the
  `HookFn` signature in editors.
- `fakeCard(overrides)` — a card object shaped like the engine's scanner
  cards (`path`, `slug`, `state`, `project`, `title`).
- `fakeCtx({card, from, to, ...})` — a hook ctx whose `pass`/`block`/`amend`
  record their verdict on `ctx.verdict`:

  ```js
  const { fakeCtx } = require('@gridconsole/plugin');
  const ctx = fakeCtx({ from: 'doing', to: 'review' });
  await myHook(ctx);
  assert.strictEqual(ctx.verdict.kind, 'block');
  ```

- `fakePluginContext(manifest)` — a plugin context that records what
  `activate()` registers (`ctx.contributions`, `ctx.hookRegistrations`,
  `ctx.logged`) and enforces the host's rule that every hook and point must
  be declared in the manifest.
