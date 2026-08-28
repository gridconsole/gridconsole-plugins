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

/** The sixteen published extension points. A point outside this union is
 *  refused when the manifest is read, not when `contribute` is called. */
export type ExtensionPoint =
  | 'stage.transition' | 'agent.provider' | 'llm.provider' | 'panel.slot'
  | 'editor.contextMenu' | 'keymap.command' | 'mcp.server' | 'sdlc.workflow'
  | 'card.section' | 'deliver.target' | 'file.explain' | 'usage.reporter'
  | 'report.redactor' | 'theme.register' | 'settings.page' | 'prompt.file';

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
  /** Whether it may spawn processes. */
  shell?: boolean;
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

/** One per-stage command an agent provider supplies. */
export interface AgentCommand {
  name: string;
  file: string;
  /** The arrow that runs it, e.g. "inbox -> prepare". */
  usedBy: string;
}

/** `agent.provider` — what runs sessions and the per-stage commands. */
export interface AgentProviderPayload {
  id: string;
  name: string;
  bin: string;
  commands: AgentCommand[];
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
