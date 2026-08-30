'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { fakePluginContext } = require('../../sdk/index.js');
const manifest = require('./grid-plugin.json');
const plugin = require('./index.js');

/** The six stages Grid starts or resumes an agent in, in pipeline order. */
const STAGES = ['prepare', 'start', 'build', 'review', 'deliver', 'verify'];

test('manifest parses and matches the design roster', () => {
  assert.match(manifest.id, /^[a-z0-9][a-z0-9-]*$/);
  assert.strictEqual(manifest.id, 'claude-provider');
  assert.strictEqual(manifest.version, '0.1.0');
  assert.strictEqual(manifest.publisher, 'grid console');
  assert.deepStrictEqual(manifest.points, ['agent.provider', 'llm.provider']);
  assert.deepStrictEqual(manifest.hooks, []);
  // The manifest's `configuration` block, verbatim — what the host parses
  // into descriptors and the Plugins pane draws a control from. The six prompt
  // rows stay LINKS: the text itself is long enough that the ⚙ panel would be
  // unreadable with six textareas in it, so the row points at the page that
  // owns them.
  //
  // The last two rows changed with the 2026-08-30 export. They used to be
  // `page` links into Settings › MCP servers and Settings › Skills; the app
  // deleted both pages, because what the Claude CLI brings to a session is the
  // CLI's business and Grid was keeping a second, drifting copy of it. They are
  // now `file` rows naming where those things really live. The kind is
  // deliberately `file` and not the design's `path`: `path` is an editable
  // value type here (grid-redact stores its rules file in one), and reusing it
  // would have made a read-only pointer look editable.
  assert.deepStrictEqual(manifest.configuration, {
    "prompts.prepare": {"type": "prompt", "title": "Prepare prompt", "default": "Settings › SDLC"},
    "prompts.start": {"type": "prompt", "title": "Start prompt (no prepare stage)", "default": "Settings › SDLC"},
    "prompts.build": {"type": "prompt", "title": "Build prompt", "default": "Settings › SDLC"},
    "prompts.review": {"type": "prompt", "title": "Self-review prompt", "default": "Settings › SDLC"},
    "prompts.deliver": {"type": "prompt", "title": "Deliver prompt", "default": "Settings › SDLC"},
    "prompts.verify": {"type": "prompt", "title": "Verify prompt", "default": "Settings › SDLC"},
    "defaultModel": {"type": "enum", "title": "Default model", "default": "sonnet", "options": ["fable", "opus", "sonnet", "haiku"]},
    "mcpConfig": {"type": "file", "title": "MCP servers", "default": ".mcp.json"},
    "skillsDir": {"type": "file", "title": "Skills", "default": ".claude/skills"}
  });
  // No row anywhere still points at a Settings page Grid no longer draws.
  for (const [key, row] of Object.entries(manifest.configuration)) {
    assert.ok(!/Settings › (MCP servers|Skills)/.test(row.default), `${key} still links to a deleted page`);
  }
  assert.strictEqual(manifest.settings, undefined, 'the Phase 2 triple is gone');
});

// Grid never ran these — it owns the agent process and talks to it over its own
// transport — so a manifest that still declared them was describing a shell
// command line nobody would ever type.
test('the executable command lines are gone from the manifest', () => {
  for (const key of Object.keys(manifest.configuration)) {
    assert.ok(!key.startsWith('commands.'), `${key} is still declared`);
  }
});

test('activate contributes the Claude agent provider descriptor', () => {
  const ctx = fakePluginContext(manifest);
  plugin.activate(ctx);
  assert.deepStrictEqual(ctx.contributions.map((c) => c.point), ['agent.provider']);
  const p = ctx.contributions[0].payload;
  assert.strictEqual(p.id, 'claude');
  assert.strictEqual(p.name, 'Claude (Claude Code)');
  assert.strictEqual(p.bin, 'claude');
  assert.strictEqual(p.commands, undefined, 'command lines are no longer contributed');
  assert.deepStrictEqual(p.prompts.map((s) => s.stage), STAGES);
  assert.strictEqual(ctx.hookRegistrations.length, 0);
});

test('every stage prompt carries a file path, an arrow and shipped text', () => {
  for (const entry of plugin.PROMPTS) {
    assert.match(entry.file, /^\.claude\/commands\/[a-z-]+\.md$/, `${entry.stage} file`);
    assert.match(entry.usedBy, /^[a-z]+ -> [a-z]+$/, `${entry.stage} usedBy`);
    assert.ok(entry.name.startsWith('/'), `${entry.stage} name`);
    assert.ok(entry.title, `${entry.stage} title`);
    assert.ok(entry.default.trim().length > 80, `${entry.stage} has real shipped text`);
  }
});

// Every stage the host can start a session in has to resolve to something, and
// a manifest row without a contribution (or the reverse) is a prompt the
// Settings page would draw with nothing behind it.
test('the manifest rows and the contributed stages are the same set', () => {
  const declared = Object.keys(manifest.configuration)
    .filter((k) => k.startsWith('prompts.'))
    .map((k) => k.slice('prompts.'.length));
  assert.deepStrictEqual(declared, STAGES);
});

// The approval gate and the picker are what the default SDLC and the
// session-start hooks are built around; wording that dropped either would
// change how every Claude card behaves.
test('the prepare prompt keeps Claude’s approval gate and its picker', () => {
  const prepare = plugin.PROMPTS.find((s) => s.stage === 'prepare');
  assert.match(prepare.default, /AskUserQuestion/);
  assert.match(prepare.default, /Ready to build/);
  assert.match(prepare.default, /Do not start building until it is approved/);
});
