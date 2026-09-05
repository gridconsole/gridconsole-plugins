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
  // 0.2.0 with the spawn contract: `permissions.spawn` is a 0.2 feature, so
  // the API range has to say so or an older host would load a manifest it
  // cannot read the most important block of.
  assert.strictEqual(manifest.version, '0.2.0');
  assert.strictEqual(manifest.apiVersion, '>=0.2');
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
  // A REFERENCE to the signed manifest's block, never a second unsigned copy
  // of it: core's contributionRefusal drops a payload that restates a spawn or
  // disagrees with one, because the payload is signed by nothing and was shown
  // to nobody before the install.
  assert.strictEqual(p.spawn, true);
  assert.strictEqual(p.bin, manifest.permissions.spawn.bin);
});

// ---------------------------------------------------------------------------
// CAPABILITIES — the two answers core cannot find out for itself, read off
// the signed manifest by gridconsole-core's sessions.js (`_isolationRefusal`,
// `_holdAccountAfterExit`) with no provider id anywhere in that code.
// ---------------------------------------------------------------------------

const ERROR_KINDS = ['retryable', 'rate_limited', 'auth_failed', 'fatal'];

test('capabilities.isolation is "env" — CLAUDE_CONFIG_DIR relocates the whole credential per account', () => {
  assert.strictEqual(manifest.capabilities.isolation, 'env');
  assert.deepStrictEqual(Object.keys(manifest.capabilities).sort(), ['errors', 'isolation']);
});

test('capabilities.errors is a four-class table of compiling, case-insensitive patterns', () => {
  const errors = manifest.capabilities.errors;
  assert.deepStrictEqual(Object.keys(errors).sort(), [...ERROR_KINDS].sort());
  for (const kind of ERROR_KINDS) {
    assert.ok(Array.isArray(errors[kind]), `${kind} is an array`);
    for (const source of errors[kind]) {
      assert.strictEqual(typeof source, 'string');
      assert.doesNotThrow(() => new RegExp(source, 'i'), `${kind}: ${source} compiles`);
    }
  }
});

/** The first class in core's precedence order whose patterns hit `text`. */
function classify(text) {
  for (const kind of ['rate_limited', 'auth_failed', 'fatal', 'retryable']) {
    for (const source of manifest.capabilities.errors[kind]) {
      const m = new RegExp(source, 'i').exec(text);
      if (m) return { kind, until: (m.groups && m.groups.until) || '' };
    }
  }
  return { kind: 'unknown', until: '' };
}

// The lines are what Claude Code 2.1.261 actually prints (read off the
// binary's own strings, and its own list of Anthropic API failure text:
// "401", "Invalid API key", "Please run /login", "rate limited",
// "overloaded", "529", "credit balance too low", "usage limit reached").
test('the table classifies the lines Claude Code really prints', () => {
  assert.strictEqual(classify('Usage limit reached · continuing shortly · esc to cancel').kind, 'rate_limited');
  assert.deepStrictEqual(classify('Usage limit reached · resets 3pm (Europe/London)'), { kind: 'rate_limited', until: '3pm (Europe/London)' });
  assert.strictEqual(classify('you have reached your weekly usage limit').kind, 'rate_limited');
  assert.strictEqual(classify('new messages wait for your usage limit to reset').kind, 'rate_limited');
  assert.strictEqual(classify('API Error: 429 {"type":"rate_limit_error"}').kind, 'rate_limited');
  assert.strictEqual(classify('Not logged in · Run /login').kind, 'auth_failed');
  assert.strictEqual(classify('Login expired · Please run /login').kind, 'auth_failed');
  assert.strictEqual(classify('Invalid API key · Please run /login').kind, 'auth_failed');
  assert.strictEqual(classify('API Error: 401 authentication_error').kind, 'auth_failed');
  assert.strictEqual(classify('{"type":"overloaded_error"}').kind, 'retryable');
  assert.strictEqual(classify('API Error: 529 Overloaded').kind, 'retryable');
  assert.strictEqual(classify('TypeError: fetch failed (ECONNRESET)').kind, 'retryable');
  assert.strictEqual(classify('Your credit balance is too low to access the Anthropic API').kind, 'fatal');
  // Ordinary output is not an error.
  assert.strictEqual(classify('Welcome to Claude Code!').kind, 'unknown');
  assert.strictEqual(classify('').kind, 'unknown');
});

// ---------------------------------------------------------------------------
// THE SPAWN CONTRACT — how Grid starts Claude Code, said in the signed
// manifest rather than in four hundred lines of gridconsole-core.
//
// The vocabularies below are transcribed from core's ide/engine/pluginhost.js
// rather than required — this package does not depend on gridconsole-core — so
// they stay pinned against the manifest actually written. If core's vocabulary
// changes, this manifest is what has to change with it, not this list.
// ---------------------------------------------------------------------------

const SPAWN_KEYS = ['bin', 'argv', 'resumeArgv', 'forkArgv', 'env', 'sessionId', 'transcript', 'hooks', 'trust'];
const SPAWN_ARGV_PLACEHOLDERS = ['prompt', 'sessionId', 'cwd', 'model', 'effort', 'cardPath',
  'agentPerms', 'permissionMode'];
const SPAWN_ENV_PLACEHOLDERS = ['stateDir', 'cwd', 'sessionId', 'cardPath', 'accountDir', 'accountId'];
const SPAWN_TRUST_FILES = ['claude-json', 'copilot-config'];
const SPAWN_ARGV_LITERAL_RE = /^-{0,2}[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SPAWN_ARGV_WHOLE_PLACEHOLDER_RE = /^\{([A-Za-z][A-Za-z0-9]*)\}$/;
const SPAWN_BIN_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

test('the spawn block names a bare program and only keys the contract closes over', () => {
  const spawn = manifest.permissions.spawn;
  assert.ok(spawn, 'grid-plugin.json must declare permissions.spawn');
  // A BARE NAME AND NOTHING ELSE. Where `claude` lives is the operator's
  // statement — their PATH, or the `claudeBin` pin in ~/.grid/config.json — and
  // never this file's: an absolute path spelled in a manifest would let a
  // plugin point at a file it shipped inside its own bundle.
  assert.strictEqual(spawn.bin, 'claude');
  assert.match(spawn.bin, SPAWN_BIN_RE);
  assert.ok(!spawn.bin.includes('/') && !spawn.bin.includes('.'), 'bin is a bare name, never a path');
  for (const key of Object.keys(spawn)) {
    assert.ok(SPAWN_KEYS.includes(key), `"${key}" is not a spawn key the contract knows`);
  }
});

test('every argv element is a bare literal or a whole-element placeholder from the closed vocabulary', () => {
  // argv is exec'd directly with no shell anywhere, so a placeholder has to be
  // a WHOLE element: whatever it expands to — spaces, quotes, newlines — is one
  // argv entry, and cannot introduce or erase an argument boundary. Embedded,
  // a path with a space in it turns one argument into two.
  for (const key of ['argv', 'resumeArgv', 'forkArgv']) {
    const argv = manifest.permissions.spawn[key];
    assert.ok(Array.isArray(argv) && argv.length, `${key} must say how to start a session`);
    for (const el of argv) {
      const asPlaceholder = SPAWN_ARGV_WHOLE_PLACEHOLDER_RE.exec(el);
      if (asPlaceholder) {
        assert.ok(SPAWN_ARGV_PLACEHOLDERS.includes(asPlaceholder[1]),
          `${key} element "${el}" uses a placeholder outside {${SPAWN_ARGV_PLACEHOLDERS.join('} {')}}`);
        continue;
      }
      assert.ok(!el.includes('{') && !el.includes('}'),
        `${key} element "${el}" embeds a placeholder inside a longer string`);
      assert.match(el, SPAWN_ARGV_LITERAL_RE, `${key} element "${el}" is not a usable literal argument`);
    }
  }
});

test('the argv sends the card its session, its model and its first turn', () => {
  const { argv, resumeArgv, forkArgv, sessionId } = manifest.permissions.spawn;
  // Grid decides the id and hands it over, rather than discovering one after
  // the fact: the card, the hook file and the transcript all name the same
  // conversation from the instant the process starts.
  assert.strictEqual(sessionId, 'mint-uuid');
  assert.deepStrictEqual(argv.slice(0, 2), ['--session-id', '{sessionId}']);
  // A card that has run before RESUMES it rather than opening a blank session
  // beside a transcript the UI is still rendering.
  assert.deepStrictEqual(resumeArgv.slice(0, 2), ['--resume', '{sessionId}']);
  // Forking a card resumes the SAME id too, but as a new conversation branched
  // off it — never a blank one — so it starts from `--resume` exactly like
  // resumeArgv, with `--fork-session` right after the id.
  assert.deepStrictEqual(forkArgv.slice(0, 3), ['--resume', '{sessionId}', '--fork-session']);
  // THE DROPPING RULE is what these three pairs are written for: no value means
  // the element AND the flag before it are removed, never `--model ''`. So an
  // unset model inherits the CLI's own default, and a card running in place
  // rather than in a worktree Grid cut sends no `--settings` at all.
  for (const template of [argv, resumeArgv, forkArgv]) {
    for (const [flag, ph] of [['--model', '{model}'], ['--effort', '{effort}'],
      ['--settings', '{agentPerms}']]) {
      assert.strictEqual(template[template.indexOf(ph) - 1], flag,
        `${ph} must follow ${flag} so the dropping rule can take both`);
    }
    // The prompt is the LAST element and carries no flag of its own: Claude
    // Code takes an initial prompt positionally, and a new session's is the
    // card context with the message that started it folded in.
    assert.strictEqual(template[template.length - 1], '{prompt}');
  }
});

test('forkArgv is resumeArgv with exactly one element inserted: --fork-session', () => {
  const { resumeArgv, forkArgv } = manifest.permissions.spawn;
  // Anything more or less than this one flag is a different contract than the
  // "resume this id, but forked" promise forkArgv exists to make.
  const withoutFork = forkArgv.filter((el) => el !== '--fork-session');
  assert.deepStrictEqual(withoutFork, resumeArgv,
    'forkArgv must equal resumeArgv once --fork-session is removed');
  assert.strictEqual(forkArgv.length, resumeArgv.length + 1,
    'forkArgv must differ from resumeArgv by exactly one element');
  assert.strictEqual(forkArgv.filter((el) => el === '--fork-session').length, 1);
});

test('the env bills the session to its own account, and does not fight core for the task list', () => {
  const env = manifest.permissions.spawn.env;
  // WHICH ANTHROPIC ACCOUNT THIS SESSION BILLS TO. `{accountDir}` is that
  // account's own config directory and is EMPTY for the primary — which is the
  // point: the env dropping rule then sets no CLAUDE_CONFIG_DIR at all, and
  // "no CLAUDE_CONFIG_DIR" is a different auth path from "CLAUDE_CONFIG_DIR
  // pointed at nothing", because the keychain item is keyed on the directory.
  assert.strictEqual(env.CLAUDE_CONFIG_DIR, '{accountDir}');
  // NOT CLAUDE_CODE_TASK_LIST_ID. Core's own shared spawn env already sets it,
  // unconditionally, to the card's slug — for every provider, not only this
  // one — because it is what `activity.js`'s task-list dock has always keyed
  // its fallback on, and a manifest naming its own value here would only ever
  // lose to core's (sessions.js logs "which Grid owns" and drops it) or, if it
  // ever won, point the dock at a directory the fallback does not know to
  // look in. Grid owns this concept; the manifest does not restate it.
  assert.strictEqual(env.CLAUDE_CODE_TASK_LIST_ID, undefined);
  for (const [name, value] of Object.entries(env)) {
    assert.match(name, /^[A-Z][A-Z0-9_]*$/, `${name} is not a usable environment variable name`);
    assert.ok(!/^(LD_|DYLD_|NODE_|BASH_|PERL|PYTHON|RUBY|GIT_|GRID_)/.test(name),
      `${name} decides what code a process loads, which Grid owns`);
    for (const [, ph] of [...String(value).matchAll(/\{([^{}]+)\}/g)]) {
      assert.ok(SPAWN_ENV_PLACEHOLDERS.includes(ph), `{${ph}} is not an env placeholder`);
    }
  }
});

test('the spawn block asks Grid to pre-answer Claude Code\'s own folder-trust prompt', () => {
  // Claude Code asks "is this a project you created or one you trust?" the
  // first time it starts somewhere it has never been, and until somebody
  // answers, NOTHING happens: no SessionStart hook, so the queued kickoff is
  // never delivered; no transcript, so the pane stays empty; and the card still
  // reads active, so the board says the agent is working.
  //
  // Grid answers it only for a directory the user themselves registered — the
  // project's own folder, a worktree Grid cut, or the workspace root — and that
  // boundary lives in core, not here. This word only says WHICH file, because
  // Claude's is `<CLAUDE_CONFIG_DIR>/.claude.json` and Copilot's is
  // `<COPILOT_HOME>/config.json`.
  const { trust } = manifest.permissions.spawn;
  assert.ok(SPAWN_TRUST_FILES.includes(trust), `"${trust}" is not a trust file core can write`);
  assert.strictEqual(trust, 'claude-json');
});

test('the spawn block declares no transcript and no hook file, and that is deliberate', () => {
  // Both are unexpressible in the contract's path grammar, and both already
  // have a working answer core owns:
  //
  //   * the transcript is `<config dir>/projects/<slugified cwd>/<id>.jsonl`.
  //     There is no placeholder for that slug, and `{env.CLAUDE_CONFIG_DIR}`
  //     is dropped entirely on the primary account, so a template would
  //     resolve to nothing for most users. Grid resolves Claude transcripts
  //     through claudehome's per-account roots instead.
  //   * the hook file is the checkout's own `.claude/settings.local.json`, and
  //     the contract REFUSES a `{cwd}`-rooted hooks file on purpose (Grid does
  //     not write into a repository to make one of its own features work).
  //     Grid installs Claude's hooks per workspace and per project already,
  //     which is a different mechanism from the per-spawn one and runs whether
  //     a session is starting or not.
  //
  // Declaring either would be a promise the file cannot keep. Written down as
  // a test so the next person to notice they are missing finds the reason.
  assert.strictEqual(manifest.permissions.spawn.transcript, undefined);
  assert.strictEqual(manifest.permissions.spawn.hooks, undefined);
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

test('the light walk is in the prompts themselves, not only in the session context', () => {
  // A heavy default prompt would undo a light context: the prompt is the
  // message the agent acts on. So each stage says what an easy card skips.
  assert.match(at('prepare'), /Decide the size first/);
  assert.match(at('prepare'), /`difficulty: easy`/);
  assert.match(at('prepare'), /set `status: doing` yourself/);
  assert.match(at('build'), /"### Checks"/);
  assert.match(at('build'), /move the card on to the stage your session context names/);
  assert.match(at('review'), /An easy card is passing through/);
  assert.match(at('verify'), /scoped to what changed/);
  assert.match(at('verify'), /instead of the whole suite/);
  // And no stage promises a fresh agent it may not get: the handoff keeps the
  // agent when the model and directory are unchanged.
  for (const stage of ['prepare', 'review', 'deliver']) {
    assert.doesNotMatch(at(stage), /fresh agent (in [A-Z][a-z]+ )?— not you/, `${stage} still promises an unconditional fresh agent`);
  }
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
