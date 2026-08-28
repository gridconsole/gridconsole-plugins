# @gridconsole/plugin

The SDK for Grid Console plugins: type definitions for the plugin contract —
the `grid-plugin.json` manifest shape, the stage-transition hooks
(`before:`/`after:` an arrow, plus `on:attention`, resolved with `ctx.pass()`,
`ctx.block({reason, fix})` or `ctx.amend({sections})`), the `activate(context)`
plugin context, and the payload shapes for the contribution points the bundled
plugins register.

The contract is documented in the Grid Console docs (Plugins section). Those
chapters are normative; this package tracks them.

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
