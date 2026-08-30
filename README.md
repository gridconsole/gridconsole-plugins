# gridconsole-plugins

The bundled plugins for [Grid Console](https://gridconsole.dev), and the
`@gridconsole/plugin` SDK they are built against. Apache-2.0.

Grid Console keeps its core small: cards, worktrees, rewind and the licence.
Everything with an opinion in it ships as one of the plugins in this repo,
loaded through the same contract third-party plugins will use.

## Layout

- `sdk/` — `@gridconsole/plugin`: the type definitions and test helpers for the
  plugin contract. The contract itself is documented in the Grid Console docs
  (Plugins section); this package follows those chapters, not the other way
  around.
- `plugins/` — the bundled, first-party plugins, one directory per plugin, each
  with a `grid-plugin.json` manifest and an entry point:
  `grid-sdlc-default`, `claude-provider`, `codex-provider`, `github-deliver`, `grid-themes`,
  `grid-explain`, `grid-usage`, `grid-redact`.

## Status

Alpha. The host loads these bundled plugins in-process and trusted; the
sandboxed runtime for third-party code, the marketplace, and signing arrive
later — the docs mark those chapters accordingly. A plugin is a directory with
a `grid-plugin.json` (id, version, host version requirement, declared permissions,
registered hooks and contributions) and an entry point; no build step.
