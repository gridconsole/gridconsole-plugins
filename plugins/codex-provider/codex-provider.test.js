'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { fakePluginContext } = require('../../sdk/index.js');
const manifest = require('./grid-plugin.json');
const plugin = require('./index.js');

/** The six stages Grid starts or resumes an agent in, in pipeline order. */
const STAGES = ['prepare', 'start', 'build', 'review', 'deliver', 'verify'];

test('manifest declares the Codex provider and its configuration', () => {
  assert.strictEqual(manifest.id, 'codex-provider');
  assert.strictEqual(manifest.version, '0.1.0');
  assert.deepStrictEqual(manifest.points, ['agent.provider', 'llm.provider']);
  assert.strictEqual(manifest.configuration.defaultModel.type, 'string');
  assert.strictEqual(manifest.configuration.sandbox.default, 'workspace-write');
  assert.deepStrictEqual(manifest.configuration.sandbox.options,
    ['read-only', 'workspace-write', 'danger-full-access']);
  const declared = Object.keys(manifest.configuration)
    .filter((k) => k.startsWith('prompts.'))
    .map((k) => k.slice('prompts.'.length));
  assert.deepStrictEqual(declared, STAGES);
  for (const key of Object.keys(manifest.configuration)) {
    assert.ok(!key.startsWith('commands.'), `${key} is still declared`);
  }
});

test('activate contributes a Codex CLI provider descriptor', () => {
  const ctx = fakePluginContext(manifest);
  plugin.activate(ctx);
  assert.deepStrictEqual(ctx.contributions.map((c) => c.point), ['agent.provider']);
  const provider = ctx.contributions[0].payload;
  assert.strictEqual(provider.id, 'codex');
  assert.strictEqual(provider.bin, 'codex');
  assert.deepStrictEqual(provider.capabilities,
    { nonInteractive: true, jsonl: true, resume: true, chat: 'experimental', terminal: true });
  assert.strictEqual(provider.interactive.mode, 'terminal');
  assert.deepStrictEqual(provider.invocation.run,
    ['exec', '--json', '--sandbox', 'workspace-write', '-']);
  assert.deepStrictEqual(provider.invocation.resume,
    ['exec', 'resume', '{sessionId}', '-']);
  assert.strictEqual(provider.commands, undefined, 'command lines are no longer contributed');
  assert.deepStrictEqual(provider.prompts.map((s) => s.stage), STAGES);
  assert.strictEqual(ctx.hookRegistrations.length, 0);
});

test('every stage prompt carries a file path, an arrow and shipped text', () => {
  for (const entry of plugin.PROMPTS) {
    assert.match(entry.file, /^\.codex\/prompts\/[a-z-]+\.md$/, `${entry.stage} file`);
    assert.match(entry.usedBy, /^[a-z]+ -> [a-z]+$/, `${entry.stage} usedBy`);
    assert.ok(entry.name.startsWith('/'), `${entry.stage} name`);
    assert.ok(entry.title, `${entry.stage} title`);
    assert.ok(entry.default.trim().length > 80, `${entry.stage} has real shipped text`);
  }
});

// THE REASON THIS PROVIDER HAS ITS OWN WORDING. Grid launches Codex with
// `--approve-for-me` inside a workspace-write sandbox: execution is authorized
// before the first message lands. Text that reads as a request for permission
// makes Codex stop and wait for an approval nobody is coming to give, so no
// shipped prompt may contain one — and the three doing-stages have to say out
// loud that acting is allowed.
test('no Codex prompt asks for approval Grid has already given', () => {
  const asks = /\bmay I (proceed|continue)\b|\bshall I\b|\bwould you like me to\b|\bis it (ok|okay) (to|if)\b|\bpermission to (proceed|continue)\b/i;
  for (const entry of plugin.PROMPTS) {
    assert.ok(!asks.test(entry.default), `${entry.stage} asks for conversational approval`);
    assert.ok(!/AskUserQuestion/.test(entry.default),
      `${entry.stage} names a tool this provider does not have`);
  }
});

test('the acting stages say the work is already authorized', () => {
  for (const stage of ['prepare', 'start', 'build', 'deliver', 'verify']) {
    const entry = plugin.PROMPTS.find((s) => s.stage === stage);
    assert.match(entry.default, /authoriz/i, `${stage} does not say it may act`);
  }
});

// Codex loses the tool but not the gate: prepare still stops for the user
// before any building starts, which is what the default SDLC is built on.
test('the prepare prompt keeps the approval gate without the picker', () => {
  const prepare = plugin.PROMPTS.find((s) => s.stage === 'prepare');
  assert.match(prepare.default, /ready to build/i);
  assert.match(prepare.default, /do not start building before it is answered/i);
});
