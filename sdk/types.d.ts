// @gridconsole/plugin — the plugin contract as the host actually implements it
// (gridconsole-core: ide/engine/pluginhost.js + ide/engine/transition.js).
// Types describe only what the host calls today; extension points the design
// names but no subsystem reads yet get no types until they do.

/** The seven pipeline stages, in order. `closed` is the engine's spelling. */
export type Stage = 'inbox' | 'prepare' | 'doing' | 'review' | 'deliver' | 'verify' | 'closed';

/**
 * A hook registers on an arrow endpoint — `after:<stage>` fires when a stage
 * completes, `before:<stage>` when it is about to begin — plus `on:attention`
 * for a card that asks for its human. Names outside this union are rejected
 * both at manifest read and at `hooks.on`.
 */
export type HookName = `before:${Stage}` | `after:${Stage}` | 'on:attention';

/** The types a setting may declare.
 *
 *  The first six hold a value the host stores and hands back at activation.
 *  `page` and `prompt` name somewhere to go — the Settings pane renders them
 *  as links to the pane that owns them — and hold nothing. A type outside this
 *  union still loads: the pane shows the row as a readout saying there is no
 *  control for it, rather than the plugin failing to load over a rendering
 *  question. */
export type SettingType =
  | 'bool' | 'string' | 'number' | 'enum' | 'string[]' | 'path'
  | 'page' | 'prompt';

/** One declared setting. `scope: 'project'` parses but is not honoured yet —
 *  this build stores values, and plugin enablement, per workspace only. */
export interface SettingSpec {
  type: SettingType | string;
  /** The value when nobody has chosen one. Required in practice for `enum`,
   *  where it must be a member of `options`. */
  default?: string | number | boolean | string[];
  /** The label the pane shows instead of the raw key. */
  title?: string;
  /** Required for `enum`; narrows the accepted values for `string[]`. */
  options?: string[];
  scope?: 'workspace' | 'project';
}

/** Phase 2's settings row: `[key, type, value]`. Still read and normalised
 *  into a `configuration` entry, so an unmigrated plugin keeps loading — but
 *  it cannot express an option list, which is why an `enum` declared this way
 *  can only be printed and never picked. Declare `configuration` instead. */
export type SettingRow = [key: string, type: string, value: string];

/** The seventeen published extension points. A point outside this union is
 *  refused when the manifest is read, not when `contribute` is called. */
export type ExtensionPoint =
  | 'stage.transition' | 'agent.provider' | 'llm.provider' | 'panel.slot'
  | 'editor.contextMenu' | 'keymap.command' | 'mcp.server' | 'sdlc.workflow'
  | 'card.section' | 'deliver.target' | 'file.explain' | 'usage.reporter'
  | 'report.redactor' | 'theme.register' | 'dictate.provider'
  | 'settings.page' | 'prompt.file';

/**
 * What a plugin is allowed to do. Declared here, enforced by the host: the
 * filesystem and shell entries become Node permission-model flags on the
 * plugin process, `network` is the only set of hosts it can reach, and
 * `cardWrite` is what makes `ctx.amend` work rather than be refused.
 *
 * Everything defaults to nothing. An absent block is not "unrestricted".
 */
export interface PluginPermissions {
  /** Hostnames this plugin may reach. Empty means no network at all. */
  network?: string[];
  /** Whether `ctx.amend({ sections })` is permitted. */
  cardWrite?: boolean;
  /** Directories it may read and write. Empty means its own directory only. */
  filesystem?: string[];
  /** Whether it may spawn processes. This is a flag on the PLUGIN WORKER —
   *  whether ITS code may fork a child process. It is a different question
   *  from `spawn` below, which names a program Grid runs on the plugin's
   *  behalf, outside that fence, with the user's own rights — and it is not
   *  overloaded to mean anything about that. */
  shell?: boolean;
  /**
   * Since plugin API 0.2: the description that lets a plugin bring its OWN
   * coding agent (`copilot`, say) as a session, without a line of core code
   * knowing that agent exists — read by `spawnOf(manifest)` and rendered for
   * an install prompt by `describeSpawn(spawn)` (both
   * gridconsole-core:ide/engine/pluginhost.js).
   *
   * It rides HERE, under `permissions`, and not in a contributed
   * `agent.provider` payload, for three properties a contribution has none
   * of: SIGNED (`permissions` is covered by the manifest's Ed25519
   * signature; a contributed payload is signed by nothing), SHOWN (printed
   * before an install, on the screen of the person saying yes), and
   * COMPARABLE (any change to this block is a widening update, which the
   * host refuses unless acknowledged — so v1 shipping `copilot` cannot
   * quietly become v2 shipping `curl`). A contributed `agent.provider`
   * payload may only REFERENCE this block (`spawn: true`) — the host drops
   * a contribution whose `spawn`, `bin`, `argv`, `resumeArgv`, `forkArgv` or
   * `env` disagrees with what is declared here. See `AgentProviderPayload.spawn`.
   *
   * See `plugins/copilot-provider/grid-plugin.json` in this repo for a real,
   * accepted spawn contract — it is the closest thing to a worked example
   * for a new provider.
   */
  spawn?: PluginSpawn;
}

// ---------------------------------------------------------------------------
// THE SPAWN CONTRACT — `permissions.spawn`, as gridconsole-core's
// ide/engine/pluginhost.js validates it (readSpawn and its helpers). Every
// closed vocabulary below is a literal union rather than `string` ON
// PURPOSE: where the validator refuses a value, the type should not offer it
// as a legal one to write. A regex constraint (bin's character set, argv's
// literal shape, env names) cannot be expressed in TypeScript at all —
// those stay `string`, documented with the pattern the host actually checks.

/** A bare program name Grid resolves off PATH at spawn time: letters,
 *  digits, "_" and "-" only — no "/", "\" or "." — matching
 *  `/^[A-Za-z0-9][A-Za-z0-9_-]*$/`, at most 64 characters. An absolute path
 *  is the operator's to pin (through their own PATH or a per-binary config
 *  entry), never the plugin's: a path spelled here could point at a file
 *  the plugin bundled inside itself, which is not "run the user's agent",
 *  it is "run my payload", bypassing the whole permission model. */
export type SpawnBin = string;

/** The closed placeholder vocabulary for a whole `argv`/`resumeArgv`
 *  element. A placeholder is never embeddable inside a longer string —
 *  `"--dir={cwd}"` is refused — because argv is exec'd directly with no
 *  shell, and only a whole-element substitution cannot change the SHAPE of
 *  the command line (whatever `{cwd}` expands to, spaces and all, is one
 *  argv entry).
 *
 *  NOT HERE: `{accountDir}`/`{accountId}`. No agent CLI seen so far takes the
 *  account on its command line — see `SpawnEnvPlaceholder` and
 *  `SpawnPathTemplate`, which do admit them.
 *
 *  `{agentPerms}` IS THE ONE PLACEHOLDER CORE HAS A SIDE EFFECT FOR: it is
 *  the absolute path of the per-card permission file Grid mints (the rows its
 *  /security page mediates, rebuilt at every spawn from the stage, the
 *  project's grid.toml and the thread's commit mode), and NAMING IT IS WHAT
 *  ASKS FOR IT — the file is written only when an argv template spells it.
 *  The document is a settings file in Claude Code's `--settings` shape, i.e.
 *  `claude-compatible` in exactly the sense `SpawnHookShape` is, so a CLI that
 *  cannot read that shape should not name it. A card running in the project's
 *  own checkout rather than a worktree Grid cut has no such file, and the
 *  dropping rule below then takes the flag in front of it away too. */
export type SpawnArgvPlaceholder =
  | '{prompt}' | '{sessionId}' | '{cwd}' | '{model}' | '{effort}' | '{cardPath}'
  | '{agentPerms}' | '{permissionMode}';

/**
 * One `argv`/`resumeArgv` element: EITHER a whole-element placeholder from
 * `SpawnArgvPlaceholder`, OR a literal flag/word matching
 * `/^-{0,2}[A-Za-z0-9][A-Za-z0-9._-]*$/` — up to two leading dashes, then
 * letters, digits, ".", "_", "-", and no "=" (so `--foo=bar` is
 * unspellable), no space, no shell metacharacter. TypeScript cannot check
 * the literal's regex; `readArgvTemplate` in pluginhost.js is the real
 * gate. `(string & {})` keeps `SpawnArgvPlaceholder`'s members suggested by
 * an editor without rejecting an arbitrary literal.
 *
 * THE DROPPING RULE, because it is this contract's most surprising
 * behaviour: when core has no value for a placeholder, that element is
 * REMOVED — and so is the element immediately before it when THAT is a
 * literal beginning with "-". Nothing is substituted: never an empty
 * string, never the literal text `"{model}"`. So `["--model", "{model}"]`
 * with no model configured contributes NO FLAG AT ALL, rather than
 * `--model ''`. `{prompt}` and `{cwd}` always have a value; `{sessionId}`
 * does whenever `sessionId: "mint-uuid"` is declared; `{model}`, `{effort}`,
 * `{cardPath}`, `{agentPerms}` and `{permissionMode}` routinely do not
 * (`{permissionMode}` is filled from the card's permission mode and is absent
 * when none is set). It exists because `@github/copilot` 1.0.82 refuses
 * `--model auto` beside `--effort <level>`.
 */
export type SpawnArgvElement = SpawnArgvPlaceholder | (string & {});

/** Placeholders an ENV VALUE may use — embeddable, unlike argv's, because an
 *  env value is one string with no argument boundary to break. `{env.X}`
 *  is refused here: one env value referring to another is a dependency
 *  graph, and nothing needs one.
 *
 *  `{accountDir}` is the config directory of the account a session bills to,
 *  and `''` for the primary — so `"CLAUDE_CONFIG_DIR": "{accountDir}"` bills
 *  a provider's own agent to whichever account the session is running under,
 *  the same way Grid's own Claude spawn already does. `{accountId}` is that
 *  account's id (`'default'` for the primary), for a manifest that wants a
 *  stable per-account subdirectory instead — `"COPILOT_HOME":
 *  "{stateDir}/accounts/{accountId}"`.
 *
 *  THE ENV DROPPING RULE: a value naming an account placeholder this install
 *  has no value for is omitted ENTIRELY — the whole variable, never an empty
 *  string, because on the primary account "no `CLAUDE_CONFIG_DIR` at all" is
 *  a different auth path from "`CLAUDE_CONFIG_DIR` pointed at nothing" (the
 *  keychain item is keyed on the directory). Every OTHER placeholder still
 *  fails loud: a value naming `{stateDir}`, `{cwd}`, `{sessionId}` or
 *  `{cardPath}` with nothing to fill it is a manifest expecting an install
 *  this is not, and that refuses rather than resolving with a hole in it. */
export type SpawnEnvPlaceholder =
  | '{stateDir}' | '{cwd}' | '{sessionId}' | '{cardPath}'
  | '{accountDir}' | '{accountId}';

/** An environment variable NAME a plugin may set: `/^[A-Z][A-Z0-9_]*$/`.
 *  Denied outright: `PATH SHELL IFS ENV PS4 PAGER EDITOR VISUAL CLASSPATH
 *  JAVA_TOOL_OPTIONS GEM_PATH LOCPATH HOSTALIASES`. Denied by prefix: `LD_
 *  DYLD_ NODE_ BASH_ PERL PYTHON RUBY GIT_ GRID_` — because every one of
 *  these decides what code a process loads or runs, rather than telling the
 *  agent where its own files are. TypeScript cannot check the denylist;
 *  `readSpawnEnv` in pluginhost.js is the real gate. */
export type SpawnEnvName = string;

/** `permissions.spawn.env`: at most 16 entries. Each value is a string of
 *  at most 1024 characters built from `SpawnEnvPlaceholder`s and literals
 *  with no ".." segment. */
export type SpawnEnv = Record<SpawnEnvName, string>;

/** How a NEW session's id is decided. Absent means Grid presets nothing and
 *  the CLI picks its own; `"mint-uuid"` means Grid mints a v4 UUID before
 *  the spawn and hands it over. Required to be `"mint-uuid"` whenever
 *  `argv` spells `{sessionId}` — otherwise the placeholder has nothing to
 *  expand to and the dropping rule would quietly remove `--session-id`. */
export type SpawnSessionId = 'mint-uuid';

/**
 * A rooted path template: at most 512 characters, no ".." segment anywhere,
 * and it must START with a root placeholder — `{stateDir}`, `{cwd}`, or
 * `{env.NAME}` naming a key this same spawn block's own `env` sets. A
 * literal `/` root is refused: this file is read by Grid and rendered into
 * a card, so a plugin may not root it anywhere on disk. Interior
 * placeholders may additionally use `{sessionId}`, `{accountId}` and
 * `{accountDir}`.
 *
 * `{accountId}` is the account a session bills to (`'default'` for the
 * primary), so a manifest can give each account its own subtree —
 * `{stateDir}/accounts/{accountId}/…` — without ever seeing that account's
 * actual config directory. `{accountDir}` is admitted for the manifest that
 * genuinely wants it, but NEITHER account placeholder may be the ROOT:
 * `{accountDir}` is empty on the primary account, and unlike an env value a
 * path cannot be dropped when it comes out empty — a root that can be empty
 * is a path that can point at `{stateDir}`'s own parent. A path naming an
 * account placeholder it has no value for fails loudly rather than resolving
 * with a hole in it.
 *
 * TypeScript cannot check the "starts with" or ".." rules;
 * `readPathTemplate` in pluginhost.js is the real gate.
 */
export type SpawnPathTemplate = string;

/** The role a mapped transcript event may claim — Grid's own transcript
 *  vocabulary, and a LITERAL word (never a selector, unlike `text`/`name`
 *  below). */
export type SpawnTranscriptRole = 'user' | 'assistant' | 'tool' | 'system';

/** A dotted field selector into one transcript event, e.g. `"data.content"`:
 *  `/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/`, at most 8
 *  segments, and never a segment named `__proto__`, `constructor` or
 *  `prototype` — those walk the prototype chain rather than the event, and
 *  a naive `obj[a][b]` adapter is how that becomes a write to
 *  `Object.prototype`. */
export type SpawnSelector = string;

/** One transcript event type's field mapping. `role` IS A LITERAL WORD;
 *  `text` and `name` ARE DOTTED SELECTORS — the difference is spelled by
 *  field, not by syntax, so `{ role: "user", text: "data.content" }` stays
 *  unambiguous. At least one of the three must be present. */
export interface SpawnTranscriptFieldMap {
  role?: SpawnTranscriptRole;
  text?: SpawnSelector;
  name?: SpawnSelector;
}

/** `permissions.spawn.transcript` — where the agent writes what it said,
 *  and how to read one line of it as a turn. */
export interface SpawnTranscript {
  /** Rooted path template — see `SpawnPathTemplate`. */
  path: SpawnPathTemplate;
  /** The only format read today; a word the adapter does not yet branch on
   *  is a word that means nothing. */
  format: 'jsonl';
  /** Dotted selector naming the field of a line that carries its event
   *  type. Defaults to `"type"` when absent. */
  event?: SpawnSelector;
  /** The agent's own event type (e.g. `"user.message"`, matching
   *  `/^[A-Za-z][A-Za-z0-9._-]*$/`) to the fields to read off it.
   *  Non-empty, at most 32 entries. */
  map: Record<string, SpawnTranscriptFieldMap>;
}

/** The one hook file shape the installer writes:
 *  `{ hooks: { <Event>: [{ matcher?, hooks: [{ type: 'command', command }] }] } }`
 *  — the shape `hookinstall.js` already merges into `settings.local.json`. */
export type SpawnHookShape = 'claude-compatible';

/** Grid's own hook event names — the right-hand side of
 *  `permissions.spawn.hooks.events`. */
export type GridHookEvent =
  | 'session-start' | 'user-prompt-submit' | 'notification' | 'stop'
  | 'session-end' | 'ask-user-question' | 'answered-question' | 'edit-write'
  | 'activity';

/**
 * `permissions.spawn.hooks` — the file Grid merges its hook entries into,
 * and which of the agent's own events carry which of Grid's.
 *
 * NOTE THE DIRECTION: a key is the AGENT's own event name, the value is one
 * of GRID's — `{ "agentStop": "stop" }`, never the reverse.
 */
export interface SpawnHooks {
  /** Rooted path template — see `SpawnPathTemplate`. */
  file: SpawnPathTemplate;
  shape: SpawnHookShape;
  /** Non-empty, at most 32 entries. Key: the agent's own event name
   *  (`/^[A-Za-z][A-Za-z0-9_-]*$/`). Value: one of `GridHookEvent`. */
  events: Record<string, GridHookEvent>;
}

/**
 * The folder-trust prompt Grid pre-answers on the user's behalf before this
 * agent's first session in a directory, named by the file it lives in.
 *
 * Both agents Grid ships stop dead the first time they start somewhere they
 * have not been — Claude Code asks "is this a project you created or one you
 * trust?", `@github/copilot` asks `Confirm folder trust` — and until somebody
 * answers, the session fires no hook, writes no transcript and does no work
 * while the board reports an agent that is working.
 *
 * A WORD RATHER THAN A BOOLEAN, because the two keep the answer in two
 * different files in two different shapes, rooted in two different variables:
 * `claude-json` is `<CLAUDE_CONFIG_DIR>/.claude.json`'s
 * `projects[dir].hasTrustDialogAccepted` (and an ABSENT `CLAUDE_CONFIG_DIR`
 * means the primary account's `~/.claude.json`); `copilot-config` is
 * `<COPILOT_HOME>/config.json`'s `trustedFolders`. A manifest cannot describe
 * either write — it is a merge into another program's config, not an argv —
 * so it NAMES one core already knows how to make, exactly as
 * `SpawnHookShape` names a file layout the installer knows how to write.
 *
 * THE SECURITY BOUNDARY IS NOT YOURS TO WIDEN. Grid asserts trust only for a
 * directory the user themselves typed into it: the project's own configured
 * folder, a worktree Grid cut, or the workspace root. Any other working
 * directory is refused and the agent's dialog stands.
 */
export type SpawnTrustFile = 'claude-json' | 'copilot-config';

/**
 * `permissions.spawn` itself — the whole contract a manifest may declare.
 * Keys are closed to the eight below; an unknown key is a load error, not a
 * silently ignored one. Read through `spawnOf(manifest)`
 * (gridconsole-core:ide/engine/pluginhost.js), which answers `null` for the
 * ordinary case of a plugin that spawns nothing.
 *
 * See `plugins/copilot-provider/grid-plugin.json` in this repo for a real,
 * accepted example of this block.
 */
export interface PluginSpawn {
  /** Bare program name — see `SpawnBin`. Resolved off PATH at spawn time. */
  bin: SpawnBin;
  /** Non-empty, at most 64 elements, each at most 256 characters. */
  argv: SpawnArgvElement[];
  /** Same element rules as `argv`. Absent means this provider can only
   *  start fresh — there is no resume shape. */
  resumeArgv?: SpawnArgvElement[];
  /** Same element rules as `argv`: resume the id given, but forked into a
   *  new conversation. Absent means this provider cannot fork. */
  forkArgv?: SpawnArgvElement[];
  /** At most 16 entries — see `SpawnEnv`. */
  env?: SpawnEnv;
  /** Absent means the CLI picks its own id. */
  sessionId?: SpawnSessionId;
  transcript?: SpawnTranscript;
  hooks?: SpawnHooks;
  /** Absent — the ordinary case — means Grid writes nothing and this agent's
   *  own folder-trust prompt stands wherever it would have stood. */
  trust?: SpawnTrustFile;
}

// ---------------------------------------------------------------------------
// CAPABILITIES — `capabilities`, a provider's own honest answers to the two
// questions core cannot find out for itself: can two of your accounts share
// one machine, and what does your failure text mean. Both ride in the signed
// manifest for the same three reasons `permissions.spawn` does (signed,
// shown, comparable): a claim about isolation or about which line means
// "rate limited" is exactly the kind of claim a hostile or merely wrong
// contribution would get wrong, and core acts on the word, generically —
// nothing in gridconsole-core names a provider id when it reads these.
// ---------------------------------------------------------------------------

/**
 * Can two Grid accounts of this provider run on one machine without one's
 * credential clobbering the other's? `'env'`: yes, a per-account variable
 * relocates the whole credential (Claude Code's `CLAUDE_CONFIG_DIR`).
 * `'filesystem'`: yes, but only by swapping files under a fixed path.
 * `'none'`: no — the credential sits somewhere no variable moves (Copilot's
 * keychain item), and core serializes this provider's sessions rather than
 * let two accounts share one login. Absent means nobody has answered yet,
 * which core reads as "nothing to degrade", never as any of the three.
 */
export type PluginIsolation = 'env' | 'filesystem' | 'none';

/**
 * The closed vocabulary a provider's failure text is mapped onto —
 * `classifyError` in gridconsole-core:ide/engine/pluginhost.js. `rate_limited`
 * and `auth_failed` hold the ACCOUNT the session billed to out of the
 * rotation (until the reset the text named, or a bounded default);
 * `retryable` and `fatal` are read but change nothing yet. `unknown` is what
 * core answers when nothing matches; it is not a class a manifest declares.
 */
export type PluginErrorKind = 'retryable' | 'rate_limited' | 'auth_failed' | 'fatal';

/**
 * `capabilities.errors` — what this provider prints when it fails, as regex
 * SOURCE strings (not RegExp objects: this is JSON), matched
 * case-insensitively against whatever the process wrote before it exited.
 * Each class is an array; an absent class is empty. When several classes
 * match one text, `rate_limited` wins over `auth_failed` over `fatal` over
 * `retryable`. A `rate_limited` pattern may carry a named group `until` —
 * `"usage limit reached(?: until (?<until>[^\n]+))?"` — whose capture core
 * parses as a date, a span ("5 minutes", "2h") or a clock time ("3pm"); a
 * capture it cannot parse, or no capture at all, holds the account for
 * core's default cooldown (five minutes). A key outside `PluginErrorKind`,
 * a value that is not an array, a pattern that is not a string, or one that
 * does not compile as a RegExp is a load error, so a typo is refused by
 * name rather than silently classifying nothing.
 *
 * See `plugins/claude-provider/grid-plugin.json` in this repo for a real,
 * accepted table.
 */
export type PluginErrorTable = Partial<Record<PluginErrorKind, string[]>>;

/** The `capabilities` block. Keys are closed to the two below; an unknown
 *  key is a load error. Absent means neither question has been answered. */
export interface PluginCapabilities {
  isolation?: PluginIsolation;
  errors?: PluginErrorTable;
}

/** When a plugin wakes up: `stage:deliver`, `view:board`, `command:<id>`.
 *  Parsed and shown today; every enabled plugin still activates at boot. */
export type ActivationEvent = `stage:${string}` | `view:${string}` | `command:${string}`;

/** The `grid-plugin.json` shape the host reads. `id` is plain kebab or
 *  reverse-domain — `grid-themes` and `dev.example.jira-sync` both validate. */
export interface PluginManifest {
  id: string;
  name?: string;
  version: string;
  /** The plugin API range you support, e.g. ">=0.1". Grid refuses to load
   *  outside it. Supersedes the Phase 2 `grid` field, which still reads. */
  apiVersion?: string;
  /** @deprecated Phase 2's app-version range. Use `apiVersion`. */
  grid?: string;
  publisher?: string;
  description?: string;
  /** Explicit and narrow. A legacy string array still parses and grants
   *  nothing, because those strings never had a vocabulary behind them. */
  permissions?: PluginPermissions | string[];
  /** The provider's own answers about isolation and failure text — see
   *  `PluginCapabilities`. Only meaningful on a plugin that declares
   *  `permissions.spawn`; read off the signed manifest, never off a
   *  contributed payload. */
  capabilities?: PluginCapabilities;
  /** Every name passed to `hooks.on` must be declared here. */
  hooks?: HookName[];
  /** Every point passed to `contribute` must be declared here. */
  points?: ExtensionPoint[];
  activation?: ActivationEvent[];
  /** Every name passed to `commands.register` must be declared here, and each
   *  must be namespaced `<pluginId>:<name>`. The declaration is what the host
   *  checks an invoke against, so a command missing from this list cannot be
   *  called however the plugin registered it. */
  commands?: CommandId[];
  /** What this plugin lets the workspace configure. The values come back on
   *  `PluginContext.settings` when the plugin activates. */
  configuration?: Record<string, SettingSpec>;
  /** @deprecated Phase 2's shape. Use `configuration`. */
  settings?: SettingRow[];
  /** Entry point relative to the plugin directory; defaults to "index.js". */
  main?: string;
}

/** A card as the engine's scanner produces it. Scanner cards carry more
 *  frontmatter-derived fields; these are the ones a hook can rely on. */
export interface Card {
  path: string;
  slug: string;
  project: string;
  title: string;
  state: Stage;
  /** The card's markdown below the frontmatter — what a stage contract reads.
   *  Present when the host serialized the move across the plugin process
   *  boundary, which is the normal case. */
  body?: string;
  /** The card's parsed frontmatter block, alongside `body`. */
  frontmatter?: Record<string, unknown>;
  [extra: string]: unknown;
}

/**
 * What a hook function receives. A hook resolves the move by calling exactly
 * one of `pass` / `block` / `amend` (calling none means pass; the last call
 * wins). There is deliberately no way to redirect a card to an arbitrary
 * stage: a hook can let a move through, stop it, or annotate the card — the
 * arrow itself belongs to the pipeline.
 */
export interface HookContext {
  card: Card;
  /** '' when the card had no prior state. */
  from: Stage | '';
  to: Stage;
  /** Why the move happened; 'observed' for agent-written moves. */
  reason: string;
  /** True when the watcher saw the move after the fact — a block is then
   *  advisory (recorded, not reverted), because the write already happened. */
  observed: boolean;
  hook: HookName;
  /** The plugin id this hook was registered under. */
  plugin: string;
  /** The card's markdown below the frontmatter, when this host puts it at the
   *  top level — the in-process loader hands you the engine's own ctx, which
   *  does. A sandboxed plugin gets the same text at `card.body` instead.
   *  Read both (`ctx.card.body ?? ctx.body`): which one arrives depends on how
   *  the host loaded you, and a hook that reads only one refuses every card
   *  under the other. Either way it is '' for a card the host could not read,
   *  so a contract hook never needs the filesystem — and a sandboxed one
   *  could not reach it anyway. */
  body?: string;
  /** The card's parsed frontmatter block, with the same two-shape rule as
   *  `body`. `{}` for an unreadable card. */
  frontmatter?: Record<string, unknown>;
  /** Let the move through (the default). */
  pass(): void;
  /** Stop the move; the reason lands on the card, the optional fix is a
   *  prompt handed to the card's own agent. */
  block(opts?: { reason?: string; fix?: string }): void;
  /** Let the move through, but first append `## <heading>` sections to the
   *  card body. */
  amend(opts?: { sections?: Record<string, string> }): void;
}

/** Sync or async; a thrown error is logged and treated as a pass. */
export type HookFn = (ctx: HookContext) => void | Promise<void>;

/** Everything a plugin may touch, handed to `activate(context)`. */
export interface PluginContext {
  id: string;
  manifest: Required<Pick<PluginManifest, 'id' | 'version' | 'main'>> & PluginManifest & { dir: string };
  /**
   * This workspace's values for the settings the manifest declares, by key —
   * whatever the operator chose, or the declared default where they have not.
   * Only the value-bearing types appear; a `page` or `prompt` row holds
   * nothing and is absent here.
   *
   * A SNAPSHOT, frozen, taken when this plugin was activated. When a value
   * changes the host disposes and re-activates the plugin, so `activate()`
   * runs again with the new object — read it there rather than caching a
   * single key, and do not expect this object to change under you.
   */
  settings: Readonly<Record<string, string | number | boolean | string[]>>;
  log(msg: string): void;
  hooks: {
    /** Register a transition hook; the name must be declared in the
     *  manifest's `hooks`. Returns an unregister function. */
    on(name: HookName, fn: HookFn): () => void;
  };
  commands: {
    /**
     * Expose a function the UI can call back into, by id. The name must be
     * declared in the manifest's `commands`. Returns an unregister function.
     *
     * This is the other half of a UI contribution. A payload crosses to the
     * host once, at activation, as data — so a contributed menu row or
     * keyboard command carries a command id and this is what that id reaches.
     * Args in and the answer out are plain JSON; nothing else crosses.
     */
    register(name: CommandId, fn: CommandFn): () => void;
  };
  /** Append a payload to a contribution registry; the point must be declared
   *  in the manifest's `points`. Registries are dumb lists the owning
   *  subsystem reads in load order. */
  contribute(point: string, payload: unknown): void;
}

/** `<pluginId>:<name>`. Namespaced because a bare id would collide with
 *  Grid's own commands in the keymap, and share the operator's stored
 *  rebinding with them. */
export type CommandId = `${string}:${string}`;

/** What a registered command does. Args and answer are plain JSON. */
export type CommandFn = (args: Record<string, unknown>) => unknown | Promise<unknown>;

/** A plugin entry point exports this. */
export interface Plugin {
  activate(context: PluginContext): void;
}

// ---------------------------------------------------------------------------
// Payload shapes for the points the bundled plugins contribute to.

/** One arrow of the SDLC transition table (the design's SDLCR rows):
 *  from, to, trigger, command, verification, owning plugin. */
export interface SdlcTransition {
  f: string;
  t: string;
  trig: string;
  cmd: string;
  ver: string;
  plug: string;
}

/** `sdlc.workflow` — a whole stage set with its contracts. */
export interface SdlcWorkflowPayload {
  stages: SdlcTransition[];
}

/** The stages a session can be started or resumed on — `stageprompts.js`'s
 *  own list (gridconsole-core:ide/engine/stageprompts.js `STAGES`), a
 *  deliberately different vocabulary from the pipeline's `Stage`: `start`
 *  is "this card's type has no prepare stage, so there is no plan to send a
 *  message about", and `adversarial` is a fresh-reviewer ROLE that Review
 *  hands a card to (server/adversarial.js), not a pipeline stage a card
 *  ever sits in. */
export type PromptStage =
  | 'prepare' | 'start' | 'build' | 'review' | 'deliver' | 'verify' | 'adversarial';

/**
 * One stage's contributed message — an entry of `agent.provider`'s
 * `prompts` array, read by `ide/engine/stageprompts.js`. Precedence at
 * resolve time: a workspace override in Settings › SDLC, then `file`'s
 * body when it exists on disk (Grid never writes it), then `default`.
 *
 * Every field but `stage` is read with a fallback in the host
 * (`(entry && entry.name) || ...`), so a sparse entry still resolves — but
 * a provider that omits `default` gets `stageprompts.js`'s own built-in
 * text sent instead of its own wording, silently.
 */
export interface AgentPromptEntry {
  stage: PromptStage;
  /** The slash-command name Settings › Commands shows, e.g. `"/prepare"`. */
  name?: string;
  title?: string;
  /** Workspace-relative path a user may keep their own override at, e.g.
   *  `".claude/commands/prepare.md"` — read fresh on every resolve. Grid
   *  never writes this file. */
  file?: string;
  /** The arrow (or resume) that sends this message, e.g.
   *  `"inbox -> prepare"` — shown for context, not used to route anything. */
  usedBy?: string;
  /** The shipped text — what actually goes out when no workspace override
   *  and no `file` exist. */
  default: string;
}

/**
 * `agent.provider` — who runs sessions with this agent, and the per-stage
 * messages it sends them. `plugins/copilot-provider/` in this repo is the
 * closest thing to a worked example for a new provider: its `grid-plugin.json`
 * is a real, accepted `permissions.spawn` block, and its `index.js` shows
 * the `spawn: true` contribution below.
 */
export interface AgentProviderPayload {
  id: string;
  name: string;
  /** Decorative when this plugin's manifest declares no `permissions.spawn`
   *  — core has always started the two bundled providers that predate the
   *  spawn contract (`claude`, `codex`) from code hard-coded in
   *  `sessions.js`, never from this string. Must equal the manifest's
   *  `permissions.spawn.bin` when one is declared — a contribution naming a
   *  different `bin` is dropped, see `spawn` below. */
  bin: string;
  /** One entry per stage where Grid starts or resumes a session with this
   *  provider. See `AgentPromptEntry`. */
  prompts: AgentPromptEntry[];
  /**
   * A reference to — never a restatement of — this plugin's own
   * `permissions.spawn` (see `PluginPermissions.spawn` and `PluginSpawn`).
   * `true` is the only value worth writing: "start me the way my manifest
   * says". The host's `contributionRefusal` (pluginhost.js) drops a
   * contribution whose `spawn` (or a restated `bin`/`argv`/`resumeArgv`/
   * `forkArgv`/`env`) disagrees with the declared block, because a contributed
   * payload is signed by nothing and shown to nobody before an install —
   * only the manifest is. Meaningful only alongside a manifest that
   * actually declares `permissions.spawn`; absent otherwise.
   */
  spawn?: true;
  /** Optional interactive transport metadata for a provider with its own
   *  session UI — read by `sessions.js` today for a provider naming the
   *  `codex-app-server-v2` protocol (codex-provider). Unrelated to
   *  `permissions.spawn`: a provider can have one, both, or neither. */
  interactive?: {
    mode?: 'terminal' | 'chat';
    approvalPolicy?: 'on-request' | 'never';
    autoApprove?: boolean;
    protocol: string;
    server?: string[];
    tui?: string[];
    items?: string[];
  };
}

/** `deliver.target` — what Deliver means: PR, MR, push, patch. */
export interface DeliverTargetPayload {
  id: string;
  name: string;
  action: string;
}

/** One row a plugin adds to the code view's right-click menu.
 *
 *  `when` is evaluated by the renderer against what is true at click time,
 *  because the payload itself is static — it crossed at activation. A row that
 *  cannot run says why instead of rendering dead. */
export interface ContextMenuItem {
  /** The command to invoke; must be one this plugin declares and registers. */
  command: CommandId;
  label: string;
  /** 'always' | 'file' (a file is open) | 'selection' (text is selected). */
  when?: 'always' | 'file' | 'selection';
}

/** One command a plugin adds to the keymap table.
 *
 *  No accelerator: a contributed command arrives unbound and the operator
 *  gives it a key, which is what keeps a plugin from silently claiming a chord
 *  Grid already answers. */
export interface KeymapCommand {
  command: CommandId;
  label: string;
  /** 'app' | 'card' | 'view' — which group the Settings table files it under. */
  group?: 'app' | 'card' | 'view';
  when?: 'always' | 'file' | 'selection';
}

/** One entry of a `theme.register` contribution (contributed as an array). */
export interface ThemeRegistration {
  id: string;
  label: string;
}

/** `file.explain` / `usage.reporter` / `report.redactor` — ownership stubs:
 *  the plugin claims the point while the subsystem still lives in core. */
export interface OwnershipPayload {
  id: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Test helpers (sdk/index.js) — unit-test a hook or an activate() without the
// engine.

/** Identity with a type: `const hook = defineHook((ctx) => { ... })`. */
export function defineHook(fn: HookFn): HookFn;

/** A card shaped like the engine's scanner cards. */
export function fakeCard(overrides?: Partial<Card>): Card;

export type Verdict =
  | { kind: 'pass' }
  | { kind: 'block'; reason: string; fix: string }
  | { kind: 'amend'; sections: Record<string, string> };

/** A HookContext whose pass/block/amend record their verdict on `verdict`. */
export interface FakeHookContext extends HookContext {
  verdict: Verdict;
}

export function fakeCtx(opts?: {
  card?: Card;
  from?: Stage | '';
  to?: Stage;
  reason?: string;
  observed?: boolean;
  hook?: HookName;
  plugin?: string;
}): FakeHookContext;

/** A PluginContext that records registrations instead of wiring them, and
 *  enforces the same declared-in-manifest rules as the host. */
export interface FakePluginContext extends PluginContext {
  contributions: Array<{ point: string; payload: unknown }>;
  hookRegistrations: Array<{ name: HookName; fn: HookFn }>;
  logged: string[];
}

export function fakePluginContext(manifest: PluginManifest): FakePluginContext;
