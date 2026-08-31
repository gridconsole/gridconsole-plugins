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

// The arrow the host draws this prompt on, and the arrow this string names, are
// the same arrow. Since the 2026-08-30 IA the stage prompt is edited on the SDLC
// RAIL, with `usedBy` printed as a footer under the box — so a row whose arrow
// disagrees with the arrow the operator clicked puts two answers on one screen.
// The host keys prompts by the stage a session STARTS in (stageprompts.stageFor),
// which is the arrow's TO stage for every prompted arrow.
test('usedBy names the arrow the host really draws this prompt on', () => {
  const ARROW = {
    prepare: 'inbox -> prepare',
    start: 'inbox -> doing',
    build: 'prepare -> doing',
    review: 'doing -> review',
    deliver: 'review -> deliver',
    verify: 'deliver -> verify',
  };
  for (const entry of plugin.PROMPTS) {
    assert.strictEqual(entry.usedBy, ARROW[entry.stage], `${entry.stage} usedBy`);
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

// --- the 2026-08-30 rewrite, pinned -----------------------------------------
//
// These five strings are the first message every Claude session in every
// workspace receives, and an untouched prompt is not an override — so shipping
// them here IS the delivery. Until now nothing pinned a word of them, and a
// botched paste would have gone out silently. What is asserted below is the
// part that is a CONTRACT: the sections other code, other stages or a person
// expects to find on the card. Prose is left free to be edited.

const at = (stage) => plugin.PROMPTS.find((s) => s.stage === stage).default;

test('prepare asks for the seven plan sections, the task-list format and the questions log', () => {
  const prepare = at('prepare');
  for (const s of ['### Summary', '### What I will change', '### How I will know it works',
    '### Requires your attention', '### Expected files I will touch', '### Related cards',
    '### List of tasks']) {
    assert.ok(prepare.includes(`"${s}"`), `prepare no longer asks for ${s}`);
  }
  // The list Grid parses for board progress: one checkbox per line, no nesting.
  assert.match(prepare, /one markdown checkbox per line/);
  assert.match(prepare, /- \[ \]/);
  assert.match(prepare, /no sub-bullets/);
  // Every question and its answer land on the card, not only in the transcript.
  assert.ok(prepare.includes('"### Questions asked"'));
});

test('build pins the task-list discipline the board reads', () => {
  const build = at('build');
  assert.match(build, /Work the approved task list in order/);
  assert.match(build, /- \[x\]/);
  assert.match(build, /never tick ahead/);
  assert.match(build, /The list is fixed at approval/);
  assert.ok(build.includes('"## Review"'));
});

// The three subsections the review prompt names are the ones review.js parses
// and the ones the operator reads first. The two the gate ALSO requires —
// "### Files touched" and "### Branch" — are deliberately not here: they arrive
// from core's carry list at the augment() seam, and asserting them in this file
// would hide the fact that this prompt on its own does not satisfy the gate.
// core's ide/engine/stageprompts.test.js is where that pairing is proven.
test('review names the three subsections the card is judged on', () => {
  const review = at('review');
  for (const s of ['### What changed', '### Assumptions', '### Needs your eyes']) {
    assert.ok(review.includes(`"${s}"`), `review no longer names ${s}`);
  }
  assert.match(review, /\[critical\][\s\S]*\[important\][\s\S]*\[minor\]/);
  assert.match(review, /do not restart the work and do not move the card/);
});

// A red pipeline and a failed verification used to end the same way: set the
// card back, write it under "### Needs your eyes", stop. They now stop ON the
// stage and ask. The escalation is the behaviour; the heading is what makes it
// findable afterwards.
test('deliver and verify stop on their own stage and ask, under their own headings', () => {
  const deliver = at('deliver');
  assert.ok(deliver.includes('"### Delivery failed"'));
  assert.match(deliver, /do not move the card/);
  assert.match(deliver, /AskUserQuestion/);
  assert.ok(!deliver.includes('set the card back to review'), 'the old escalation is still shipping');

  const verify = at('verify');
  assert.ok(verify.includes('"### Verification failed"'));
  assert.match(verify, /keep it in verify/);
  assert.match(verify, /AskUserQuestion/);
});

// The skip ruling is NEWER than the design export, whose DELIVER>VERIFY knows
// only pass and fail. Transcribing that string wholesale would have reverted it.
test('the rewrite did not take the skip outcome back out of verify', () => {
  const verify = at('verify');
  assert.match(verify, /is SKIPPED/);
  assert.match(verify, /A skip is neither a pass nor a failure/);
  assert.match(verify, /A skip on its own is not a failure and does not hold the card/);
  assert.match(verify, /pass, fail or skipped per step/);
  // "Only on pass" — the export's wording — would hold every skipped card.
  assert.ok(!/Only on pass/.test(verify), 'the export sentence contradicts the skip ruling');
});

// The design's rail has five arrows and no entry for `start`, so the rewrite
// supplied no text for it. A card whose type walks no Prepare still has to
// start — and since the 2026-08-30 ruling this is also the message it gets when
// it is PICKED BACK UP in doing (stageprompts.stageFor reads `refines` there
// too), because the build prompt talks about an approved task list that card
// never had. One text now serves both, so it has to be true of both: it may not
// promise a plan, and it may not read as a fresh beginning.
test('start speaks for a card with no plan, whether it is beginning or resuming', () => {
  const start = at('start');
  assert.match(start, /your type has no prepare stage/);
  assert.match(start, /no approved task list/);
  assert.match(start, /picked back up/);
  assert.match(start, /Carry on from there rather than starting again/);
  assert.ok(!/approved task list in order/.test(start),
    'start must never carry the build prompt’s language about a list it has no approval for');
  assert.strictEqual(plugin.PROMPTS.filter((s) => s.stage === 'start').length, 1);
  assert.ok(start.trim().length > 80);
});
