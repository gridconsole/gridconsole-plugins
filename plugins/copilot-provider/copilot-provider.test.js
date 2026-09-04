'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { fakePluginContext } = require('../../sdk/index.js');
const manifest = require('./grid-plugin.json');
const plugin = require('./index.js');

/** The six stages Grid starts or resumes an agent in, in pipeline order. */
const STAGES = ['prepare', 'start', 'build', 'review', 'deliver', 'verify'];

// The closed vocabulary from gridconsole-core's spawn contract
// (ide/engine/pluginhost.js, THE SPAWN CONTRACT). Transcribed rather than
// required — this package does not depend on gridconsole-core — so these
// stay pinned against the manifest actually written, not against a moving
// implementation. If core's vocabulary ever changes, this manifest is the
// thing that has to change with it, not this list.
const SPAWN_KEYS = ['bin', 'argv', 'resumeArgv', 'env', 'sessionId', 'transcript', 'hooks', 'trust'];
const SPAWN_ARGV_PLACEHOLDERS = ['prompt', 'sessionId', 'cwd', 'model', 'effort', 'cardPath',
  'agentPerms'];
const SPAWN_TRUST_FILES = ['claude-json', 'copilot-config'];
const SPAWN_ARGV_LITERAL_RE = /^-{0,2}[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SPAWN_ARGV_WHOLE_PLACEHOLDER_RE = /^\{([A-Za-z][A-Za-z0-9]*)\}$/;
const SPAWN_BIN_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const SPAWN_HOOK_EVENTS = ['session-start', 'user-prompt-submit', 'notification', 'stop',
  'session-end', 'ask-user-question', 'answered-question', 'edit-write', 'activity'];
const SPAWN_ROLES = ['user', 'assistant', 'tool', 'system'];

test('manifest declares the Copilot provider and its configuration', () => {
  assert.strictEqual(manifest.id, 'copilot-provider');
  assert.strictEqual(manifest.version, '0.1.0');
  assert.deepStrictEqual(manifest.points, ['agent.provider', 'llm.provider']);
  assert.strictEqual(manifest.configuration.defaultModel.type, 'string',
    'the catalogue is GitHub\'s and an entitlement can refuse a model it lists — free text, not an enum');
  assert.strictEqual(manifest.configuration.defaultModel.default, '', 'empty means auto');
  assert.strictEqual(manifest.configuration.mcpConfig.default, '.github/mcp.json');
  assert.strictEqual(manifest.configuration.instructions.default, 'AGENTS.md');
  const declared = Object.keys(manifest.configuration)
    .filter((k) => k.startsWith('prompts.'))
    .map((k) => k.slice('prompts.'.length));
  assert.deepStrictEqual(declared, STAGES);
  for (const key of Object.keys(manifest.configuration)) {
    assert.ok(!key.startsWith('commands.'), `${key} is still declared`);
  }
});

// This is the first plugin in the repo to raise its apiVersion floor, because
// it is the first one that cannot run without the 0.2 spawn contract: a Grid
// old enough to ignore `permissions.spawn` would load this manifest and start
// nothing.
test('this provider raises the floor the spawn contract requires', () => {
  assert.strictEqual(manifest.apiVersion, '>=0.2');
});

// The operator ruled this ships unstable; readManifest throws on an unstable
// plugin with no note, so the note is not decorative.
test('stability is unstable with a real note about what is unproven', () => {
  assert.strictEqual(manifest.stability.level, 'unstable');
  assert.ok(manifest.stability.note && manifest.stability.note.trim().length > 20,
    'the note must say what is actually unproven');
});

test('activate contributes a Copilot provider descriptor that only references the spawn permission', () => {
  const ctx = fakePluginContext(manifest);
  plugin.activate(ctx);
  assert.deepStrictEqual(ctx.contributions.map((c) => c.point), ['agent.provider']);
  const provider = ctx.contributions[0].payload;
  assert.strictEqual(provider.id, 'copilot');
  assert.strictEqual(provider.bin, manifest.permissions.spawn.bin, 'the contributed bin must match the declared spawn');
  assert.strictEqual(provider.spawn, true, 'a contribution may only reference the manifest\'s spawn, never restate it');
  assert.deepStrictEqual(provider.prompts.map((s) => s.stage), STAGES);
  assert.strictEqual(ctx.hookRegistrations.length, 0);
});

test('every stage prompt carries a file path, an arrow and shipped text', () => {
  for (const entry of plugin.PROMPTS) {
    assert.match(entry.file, /^\.github\/prompts\/[a-z-]+\.md$/, `${entry.stage} file`);
    assert.match(entry.usedBy, /^[a-z]+ -> [a-z]+$/, `${entry.stage} usedBy`);
    assert.ok(entry.name.startsWith('/'), `${entry.stage} name`);
    assert.ok(entry.title, `${entry.stage} title`);
    assert.ok(entry.default.trim().length > 80, `${entry.stage} has real shipped text`);
  }
});

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

// --- the spawn block itself --------------------------------------------

test('the spawn bin is a bare program name', () => {
  const spawn = manifest.permissions.spawn;
  assert.ok(spawn, 'grid-plugin.json must declare permissions.spawn');
  assert.strictEqual(spawn.bin, 'copilot');
  assert.match(spawn.bin, SPAWN_BIN_RE);
  assert.ok(!spawn.bin.includes('/') && !spawn.bin.includes('.'), 'bin is a bare name, never a path');
});

test('the spawn block declares only the keys the contract closes over', () => {
  const spawn = manifest.permissions.spawn;
  for (const key of Object.keys(spawn)) {
    assert.ok(SPAWN_KEYS.includes(key), `"${key}" is not a spawn key the contract knows`);
  }
});

// Copilot asks `Confirm folder trust` the first time it starts in a directory
// it has not seen, and until somebody answers it runs no turn at all: no hook
// fires, no transcript is written, and Grid's board reports an agent that is
// working. Grid pre-answers it for the directories the user themselves
// registered — and it used to do that because core hardcoded this plugin's id.
// `trust` is the manifest saying it instead, so the engine no longer carries
// this provider's name; the word names WHICH file, because Claude's is
// `<CLAUDE_CONFIG_DIR>/.claude.json` and this one is
// `<COPILOT_HOME>/config.json`'s `trustedFolders`.
test('the spawn block asks Grid to pre-answer Copilot\'s own folder-trust prompt', () => {
  const { trust } = manifest.permissions.spawn;
  assert.ok(SPAWN_TRUST_FILES.includes(trust), `"${trust}" is not a trust file core can write`);
  assert.strictEqual(trust, 'copilot-config');
  // The file it names is rooted in this block's own COPILOT_HOME, which is
  // inside Grid's state dir — never the user's real ~/.copilot.
  assert.match(manifest.permissions.spawn.env.COPILOT_HOME, /^\{stateDir\}\//);
});

// Every argv element is either a literal flag/word, or a WHOLE-ELEMENT
// placeholder from the closed vocabulary — never a placeholder embedded
// inside a longer string, because argv is exec'd with no shell to catch a
// value that turns one argument into two.
test('every argv element is a bare literal or a whole-element placeholder from the closed vocabulary', () => {
  for (const key of ['argv', 'resumeArgv']) {
    const argv = manifest.permissions.spawn[key];
    if (!argv) continue;
    for (const el of argv) {
      const asPlaceholder = SPAWN_ARGV_WHOLE_PLACEHOLDER_RE.exec(el);
      if (asPlaceholder) {
        assert.ok(SPAWN_ARGV_PLACEHOLDERS.includes(asPlaceholder[1]),
          `${key} element "${el}" uses a placeholder outside {${SPAWN_ARGV_PLACEHOLDERS.join('} {')}}`);
        continue;
      }
      assert.ok(!el.includes('{') && !el.includes('}'),
        `${key} element "${el}" embeds a placeholder inside a longer string — a placeholder must be the whole element`);
      assert.match(el, SPAWN_ARGV_LITERAL_RE, `${key} element "${el}" is not a usable literal argument`);
    }
  }
});

// The finding this card exists to surface: Copilot refuses `--model auto`
// together with `--effort <level>` ("Model \"auto\" does not support
// reasoning effort configuration"), and `--effort` alone fails identically
// because the default model IS auto. So {effort} must never appear in argv.
//
// CORRECTED 2026-09-03 by a live run against a real daemon: this argv also
// declared `--model {model}`, on the belief that the dropping rule would omit
// the flag whenever no model was pinned. It never omits it. Core fills
// `{model}` from the WORKSPACE MATRIX (`sessions.js` `agentConfigFor` — the
// compute-budget tiles), so the value is always present and is always GRID'S
// OWN vocabulary: a real session spawned `--model sonnet`, and Copilot answered
// `Error: Model "sonnet" from --model flag is not available.` Grid's model names
// are not Copilot's, and the spawn contract has no seam for translating one to
// the other (`pluginhost.js` SPAWN_KEYS: bin, argv, resumeArgv, env, sessionId,
// transcript, hooks — no model map). So the flag is not sent at all and Copilot
// runs on its own default, which is what `--model auto` would have selected
// anyway. The consequence is real and belongs in the docs rather than hidden
// here: the compute-budget matrix does not reach a Copilot session.
test('argv sends neither {effort} nor {model} — Copilot shares neither vocabulary with Grid', () => {
  const spawn = manifest.permissions.spawn;
  assert.ok(!spawn.argv.includes('{effort}'), 'new-session argv must not send {effort}');
  assert.ok(!(spawn.resumeArgv || []).includes('{effort}'), 'resumeArgv must not send {effort}');
  // The one that cost a live session: `{model}` is filled from Grid's matrix,
  // not from anything this plugin declares, so sending it sends a name the CLI
  // has never heard of.
  assert.ok(!spawn.argv.includes('{model}'), 'new-session argv must not send {model}');
  assert.ok(!(spawn.resumeArgv || []).includes('{model}'), 'resumeArgv must not send {model}');
});

test('{sessionId} in a new-session argv is backed by sessionId: "mint-uuid"', () => {
  const spawn = manifest.permissions.spawn;
  if (spawn.argv.includes('{sessionId}')) {
    assert.strictEqual(spawn.sessionId, 'mint-uuid');
  }
});

test('the transcript path is rooted under the env var this same block sets, and the field names are the verified ones', () => {
  const { transcript, env } = manifest.permissions.spawn;
  assert.ok(transcript.path.startsWith('{env.COPILOT_HOME}/'), 'the path must be rooted in a directory this block declares');
  assert.ok(env && Object.prototype.hasOwnProperty.call(env, 'COPILOT_HOME'), 'COPILOT_HOME must be set for {env.COPILOT_HOME} to resolve');
  assert.strictEqual(transcript.format, 'jsonl');
  // Verified against a real transcript: assistant text is data.content, not
  // data.text, and a tool call's name is data.toolName, not data.name.
  assert.strictEqual(transcript.map['user.message'].text, 'data.content');
  assert.strictEqual(transcript.map['assistant.message'].text, 'data.content');
  assert.strictEqual(transcript.map['tool.execution_start'].name, 'data.toolName');
  for (const row of Object.values(transcript.map)) {
    if (row.role !== undefined) assert.ok(SPAWN_ROLES.includes(row.role), `unknown role ${row.role}`);
  }
});

test('the hook file lives under COPILOT_HOME, not grid.json, and speaks the claude-compatible shape', () => {
  const { hooks } = manifest.permissions.spawn;
  assert.strictEqual(hooks.file, '{env.COPILOT_HOME}/hooks/hooks.json');
  assert.strictEqual(hooks.shape, 'claude-compatible');
});

// The direction is fixed: the agent's own event name is the KEY, Grid's is
// the VALUE — {"agentStop": "stop"}, never the reverse.
test('hooks.events maps Copilot\'s own event names onto Grid\'s vocabulary, in that direction', () => {
  const { events } = manifest.permissions.spawn.hooks;
  const names = Object.keys(events);
  assert.ok(names.length > 0);
  for (const name of names) {
    assert.match(name, /^[A-Za-z][A-Za-z0-9_-]*$/, `"${name}" is not a usable agent event name`);
    assert.ok(SPAWN_HOOK_EVENTS.includes(events[name]),
      `hooks.events.${name} is "${events[name]}", which is not one of Grid's events`);
  }
  // Sampled rather than exhaustive: these are the two proven by running real
  // hooks (sessionStart and agentStop actually fired; postToolUse did not,
  // because the probe session called no tools).
  assert.strictEqual(events.sessionStart, 'session-start');
  assert.strictEqual(events.agentStop, 'stop');
});

// --- the wording -------------------------------------------------------

test('the acting stages say the work is already authorized', () => {
  for (const stage of ['prepare', 'start', 'build', 'deliver', 'verify']) {
    const entry = plugin.PROMPTS.find((s) => s.stage === stage);
    assert.match(entry.default, /authoriz/i, `${stage} does not say it may act`);
  }
});

test('the prepare prompt keeps the approval gate and names the ask_user tool', () => {
  const prepare = plugin.PROMPTS.find((s) => s.stage === 'prepare');
  assert.match(prepare.default, /ready to build/i);
  assert.match(prepare.default, /do not start building before it is answered/i);
  assert.match(prepare.default, /ask_user/);
});

// Copilot's escalation keeps a real tool, unlike codex-provider's (which has
// none) — and it is Copilot's own tool name, not Claude's.
test('deliver and verify escalate with the ask_user tool, and no prompt names the wrong provider\'s tool', () => {
  for (const stage of ['deliver', 'verify']) {
    const entry = plugin.PROMPTS.find((s) => s.stage === stage);
    assert.match(entry.default, /ask the user with the ask_user tool/);
  }
  for (const entry of plugin.PROMPTS) {
    assert.ok(!/AskUserQuestion/.test(entry.default), `${entry.stage} names a tool this provider does not have`);
    assert.ok(!/a question is a message in the conversation/i.test(entry.default),
      `${entry.stage} copies codex's framing, which is false here — this provider has a real tool`);
  }
});

// THE ONE WORDING RULE THIS PROVIDER CANNOT GET WRONG. Grid launches Copilot
// with `--allow-all-tools`, so execution is authorized before the first
// message lands — no shipped prompt may read as a request for permission to
// act. The siblings have no such test; it is added here because this is the
// provider that most needs it: `--effort`/`--model` aside, an agent that
// stops to ask "may I?" with the ask_user tool sitting right there is the
// specific failure mode this card exists to rule out.
test('no shipped prompt asks for permission to act', () => {
  const forbidden = [/\bmay i\b/i, /\bshould i proceed\b/i, /\bask for permission\b/i];
  for (const entry of plugin.PROMPTS) {
    for (const re of forbidden) {
      assert.ok(!re.test(entry.default), `${entry.stage} matches ${re} — reads as a request for permission`);
    }
  }
});

const at = (stage) => plugin.PROMPTS.find((s) => s.stage === stage).default;

test('prepare asks for the same seven plan sections the other providers ask for', () => {
  const prepare = at('prepare');
  for (const s of ['### Summary', '### What I will change', '### How I will know it works',
    '### Requires your attention', '### Expected files I will touch', '### Related cards',
    '### List of tasks']) {
    assert.ok(prepare.includes(`"${s}"`), `prepare no longer asks for ${s}`);
  }
  assert.match(prepare, /one markdown checkbox per line/);
  assert.match(prepare, /- \[ \]/);
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

test('review names the three subsections the card is judged on', () => {
  const review = at('review');
  for (const s of ['### What changed', '### Assumptions', '### Needs your eyes']) {
    assert.ok(review.includes(`"${s}"`), `review no longer names ${s}`);
  }
  assert.match(review, /\[critical\][\s\S]*\[important\][\s\S]*\[minor\]/);
});

test('deliver and verify stop on their own stage and ask, under their own headings', () => {
  const deliver = at('deliver');
  assert.ok(deliver.includes('"### Delivery failed"'));
  assert.match(deliver, /do not move the card/);
  assert.ok(!deliver.includes('set the card back to review'), 'the old escalation is still shipping');

  const verify = at('verify');
  assert.ok(verify.includes('"### Verification failed"'));
  assert.match(verify, /keep it in verify/);
});

test('the skip outcome survives in verify', () => {
  const verify = at('verify');
  assert.match(verify, /is SKIPPED/);
  assert.match(verify, /A skip is neither a pass nor a failure/);
  assert.match(verify, /A skip on its own is not a failure and does not hold the card/);
  assert.match(verify, /pass, fail or skipped per step/);
  assert.ok(!/Only on pass/.test(verify), 'the export sentence contradicts the skip ruling');
});

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
