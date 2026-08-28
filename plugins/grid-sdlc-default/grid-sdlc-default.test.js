'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { fakePluginContext, fakeCtx } = require('../../sdk/index.js');
const manifest = require('./grid-plugin.json');
const plugin = require('./index.js');

const HOOK_RE = /^(?:before|after):(?:inbox|prepare|doing|review|deliver|verify|closed)$|^on:attention$/;

test('manifest parses and matches the design roster', () => {
  assert.match(manifest.id, /^[a-z0-9][a-z0-9-]*$/);
  assert.strictEqual(manifest.id, 'grid-sdlc-default');
  assert.strictEqual(manifest.version, '0.1.0');
  assert.strictEqual(manifest.publisher, 'grid console');
  assert.deepStrictEqual(manifest.points, ['sdlc.workflow', 'card.section']);
  for (const hook of manifest.hooks) assert.match(hook, HOOK_RE);
  // The manifest's `configuration` block, verbatim — what the host parses
  // into descriptors and the Plugins pane draws a control from.
  assert.deepStrictEqual(manifest.configuration, {
    "stages": {"type": "enum[]", "title": "Stages", "default": "inbox, prepare, doing, review, deliver, verify, close"},
    "requireSections": {"type": "bool", "title": "Require the Review contract", "default": true},
    "autoAdvanceVerify": {"type": "bool", "title": "Advance to verify automatically", "default": true}
  });
  assert.strictEqual(manifest.settings, undefined, 'the Phase 2 triple is gone');
});

test('activate contributes the seven-transition table', () => {
  const ctx = fakePluginContext(manifest);
  plugin.activate(ctx);
  assert.deepStrictEqual(ctx.contributions.map((c) => c.point), ['sdlc.workflow', 'card.section']);
  const { stages } = ctx.contributions[0].payload;
  assert.strictEqual(stages.length, 7);
  assert.deepStrictEqual(stages.map((s) => s.f), ['INBOX', 'PREPARE', 'DOING', 'REVIEW', 'DELIVER', 'VERIFY', 'CLOSE']);
  assert.deepStrictEqual(stages[3], {
    f: 'REVIEW', t: 'DELIVER', trig: 'your review approve',
    cmd: 'git commit && gh pr create --fill',
    ver: 'app starts locally · you approved', plug: 'github-deliver',
  });
  for (const row of stages) {
    assert.deepStrictEqual(Object.keys(row), ['f', 't', 'trig', 'cmd', 'ver', 'plug']);
  }
});

// The STAGE CONTRACTS card in Settings > SDLC, which was a hardcoded constant
// in core (settingsModel.ts STAGE_CONTRACTS) until `card.section` got a reader.
// These assertions are that constant's design pin, moved here with the data:
// the pane draws whatever this contributes, so this is the only place left
// where the seven contracts can be checked against the design.
test('activate contributes the seven stage contracts', () => {
  const ctx = fakePluginContext(manifest);
  plugin.activate(ctx);
  const { stages } = ctx.contributions[1].payload;
  assert.deepStrictEqual(stages.map((s) => s.stage),
    ['INBOX', 'PREPARE', 'DOING', 'REVIEW', 'DELIVER', 'VERIFY', 'CLOSE']);
  // No colour in the payload: core derives it from the stage name, so a
  // workflow and its contracts cannot disagree about what colour REVIEW is.
  for (const row of stages) {
    assert.deepStrictEqual(Object.keys(row), ['stage', 'scope', 'chips']);
    assert.ok(row.scope.length > 10, `${row.stage} needs a scope sentence`);
    for (const chip of row.chips) {
      assert.deepStrictEqual(Object.keys(chip), ['label', 'kind']);
      assert.ok(['sec', 'auto', 'on', 'off', 'ok', 'ghost'].includes(chip.kind), chip.kind);
    }
  }
});

test('the fixture highlights survive: inbox is a queue, review pairs a setting, verify is checks', () => {
  const by = Object.fromEntries(plugin.CONTRACTS.map((s) => [s.stage, s]));
  assert.deepStrictEqual(by.INBOX.chips, [{ label: 'no contract: just a queue', kind: 'auto' }]);
  const review = by.REVIEW.chips;
  for (const chip of [
    { label: 'review: per change', kind: 'on' },
    { label: 'review: all at once', kind: 'off' },
    { label: 'start the app locally · show port', kind: 'ok' },
  ]) assert.ok(review.some((c) => c.label === chip.label && c.kind === chip.kind), chip.label);
  assert.strictEqual(by.VERIFY.chips.filter((c) => c.kind === 'ok').length, 3);
  // Every non-inbox editable stage ends on a ghost add-affordance.
  for (const row of plugin.CONTRACTS) {
    if (row.stage === 'INBOX' || row.stage === 'DELIVER') continue;
    assert.strictEqual(row.chips[row.chips.length - 1].kind, 'ghost', row.stage);
  }
});

// The documented REVIEW chips and the list the gate actually enforces are two
// different vocabularies, and they now live in one file for the first time.
// This pins that they are still different, so collapsing them stays a
// deliberate later change rather than something that happens by accident.
test('the documented review chips are not the enforced list, and that is on purpose', () => {
  const review = plugin.CONTRACTS.find((s) => s.stage === 'REVIEW');
  const labels = review.chips.map((c) => c.label);
  for (const name of plugin.REVIEW_SECTIONS) assert.ok(!labels.includes(name), name);
});

test('activate registers before:review and nothing else', () => {
  const ctx = fakePluginContext(manifest);
  plugin.activate(ctx);
  assert.deepStrictEqual(ctx.hookRegistrations.map((h) => h.name), ['before:review']);
  // before:deliver stays declared and unregistered on purpose — nothing in the
  // engine can observe "app starts locally".
  assert.ok(manifest.hooks.includes('before:deliver'));
});

test('requireSections defaults to on, so a workspace that never chose is unchanged', () => {
  assert.strictEqual(manifest.configuration.requireSections.default, true);
  const ctx = fakePluginContext(manifest);
  assert.strictEqual(ctx.settings.requireSections, true);
  plugin.activate(ctx);
  assert.deepStrictEqual(ctx.hookRegistrations.map((h) => h.name), ['before:review']);
});

test('requireSections off does not register the gate at all', () => {
  // Not "registers and always passes": a gate that runs and never refuses
  // still shows as this plugin's hook on every move. Off means the arrow has
  // no contract on it, which is what the setting says.
  const ctx = fakePluginContext(manifest, { requireSections: false });
  plugin.activate(ctx);
  assert.deepStrictEqual(ctx.hookRegistrations, []);
  // the contributions are unaffected — neither the stages nor the contracts
  // are the gate, and turning the gate off must not blank the SDLC page
  assert.deepStrictEqual(ctx.contributions.map((c) => c.point), ['sdlc.workflow', 'card.section']);
});

test('a host that hands over no settings at all still gates — absent is not off', () => {
  const ctx = fakePluginContext(manifest);
  ctx.settings = undefined;
  plugin.activate(ctx);
  assert.deepStrictEqual(ctx.hookRegistrations.map((h) => h.name), ['before:review']);
});

// --- the Review contract ---------------------------------------------------

const FULL = `
## Review

### Needs your eyes
Nothing.

### Assumptions
None.

### What changed
Everything.

### Files touched
- a.js

### Branch
main
`;

const gate = (body, frontmatter) => {
  const ctx = fakeCtx({ from: 'doing', to: 'review', body, frontmatter });
  plugin.reviewGate(ctx);
  return ctx.verdict;
};

test('a complete Review section passes', () => {
  assert.strictEqual(gate(FULL).kind, 'pass');
});

test('missing sections are named, in contract order', () => {
  const body = FULL.replace('### Assumptions\nNone.\n', '').replace('### Branch\nmain\n', '');
  const v = gate(body);
  assert.strictEqual(v.kind, 'block');
  assert.strictEqual(v.reason, 'Review contract: missing Assumptions, Branch');
  assert.match(v.fix, /Assumptions, Branch/);
});

test('no Review section at all blocks, and says so plainly', () => {
  const v = gate('Just some prose about the work.\n');
  assert.strictEqual(v.kind, 'block');
  assert.strictEqual(v.reason, 'Review contract: no "## Review" section');
  // The fix names the whole contract, and never reads "the missing Review
  // section — Review —", which is what a single shared template produced.
  assert.match(v.fix, /Add a "## Review" section to the card with: Needs your eyes, Assumptions, What changed, Files touched, Branch/);
  assert.doesNotMatch(v.fix, /— Review —/);
});

test('an empty or unreadable body blocks rather than sailing through', () => {
  assert.strictEqual(gate('').kind, 'block');
});

test('a suffixed Review heading counts — real cards write them', () => {
  for (const head of [
    '## Review · 2026-08-24',
    '## Review (round 2, after the rework)',
    '## Review — the alpha cut is built (2026-08-24)',
    '## Review: round 1',
  ]) {
    assert.strictEqual(gate(FULL.replace('## Review', head)).kind, 'pass', head);
  }
});

test('prose that merely starts with the word Review is not the section', () => {
  const body = '## Review sections + "Approve review" = POST /api/card/approve\n\nSome notes.\n';
  const v = gate(body);
  assert.strictEqual(v.kind, 'block');
  assert.strictEqual(v.reason, 'Review contract: no "## Review" section');
});

test('subsections are matched at any depth, case-insensitively, with suffixes', () => {
  const body = `## review
## NEEDS YOUR EYES
## assumptions
#### What changed — since the plan
### files touched
### Branch: main
`;
  assert.strictEqual(gate(body).kind, 'pass');
});

// The two hosts hand the content over differently: a sandboxed plugin gets it
// on the card, an in-process one at the top level. A gate that read only one
// would refuse every card under the other, so both shapes are pinned here
// rather than left to whichever the fake happens to build.
test('the sandboxed ctx shape (content on the card) is read', () => {
  const ctx = {
    card: { slug: 'x', state: 'doing', body: FULL, frontmatter: {} },
    from: 'doing', to: 'review', reason: '', observed: false,
    verdict: { kind: 'pass' },
    pass() { ctx.verdict = { kind: 'pass' }; },
    block(o) { ctx.verdict = { kind: 'block', ...o }; },
    amend() {},
  };
  plugin.reviewGate(ctx);
  assert.strictEqual(ctx.verdict.kind, 'pass');
});

test('the in-process ctx shape (content at the top level) is read', () => {
  const ctx = {
    card: { slug: 'x', state: 'doing' },
    body: FULL, frontmatter: {},
    from: 'doing', to: 'review', reason: '', observed: false,
    verdict: { kind: 'pass' },
    pass() { ctx.verdict = { kind: 'pass' }; },
    block(o) { ctx.verdict = { kind: 'block', ...o }; },
    amend() {},
  };
  plugin.reviewGate(ctx);
  assert.strictEqual(ctx.verdict.kind, 'pass');
});

test('a ctx carrying no content at all blocks rather than crashing', () => {
  const ctx = {
    card: { slug: 'x', state: 'doing' },
    from: 'doing', to: 'review',
    verdict: { kind: 'pass' },
    pass() { ctx.verdict = { kind: 'pass' }; },
    block(o) { ctx.verdict = { kind: 'block', ...o }; },
    amend() {},
  };
  plugin.reviewGate(ctx);
  assert.strictEqual(ctx.verdict.kind, 'block');
});

test('contract: off in the frontmatter waives the gate', () => {
  assert.strictEqual(gate('nothing at all', { contract: 'off' }).kind, 'pass');
  assert.strictEqual(gate('nothing at all', { contract: 'on' }).kind, 'block');
  assert.strictEqual(gate('nothing at all', {}).kind, 'block');
});
