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
  // The manifest's `configuration` block, verbatim — what the host parses
  // into descriptors and the Plugins pane draws a control from.
  assert.deepStrictEqual(manifest.configuration, {
    "commands.prepare": {"type": "string", "title": "Prepare command", "default": "claude /prepare {card.md}"},
    "commands.build": {"type": "string", "title": "Build command", "default": "claude /build {card.md} --plan {plan.md}"},
    "commands.review": {"type": "string", "title": "Self-review command", "default": "claude /self-review {diff}"},
    "prompts.prepare": {"type": "prompt", "title": "Prepare prompt", "default": ".claude/commands/prepare.md"},
    "prompts.build": {"type": "prompt", "title": "Build prompt", "default": ".claude/commands/build.md"},
    "prompts.review": {"type": "prompt", "title": "Self-review prompt", "default": ".claude/commands/self-review.md"},
    "defaultModel": {"type": "enum", "title": "Default model", "default": "sonnet", "options": ["fable", "opus", "sonnet", "haiku"]},
    "mcp.servers": {"type": "page", "title": "MCP servers", "default": "Settings › MCP servers"},
    "skills": {"type": "page", "title": "Skills", "default": "Settings › Skills"}
  });
  assert.strictEqual(manifest.settings, undefined, 'the Phase 2 triple is gone');
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
