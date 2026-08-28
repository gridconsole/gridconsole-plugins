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

/** One manifest settings row: [key, type, value]. Declarative only — the
 *  Settings › Plugins page renders these; the host does not interpret them. */
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
  log(msg: string): void;
  hooks: {
    /** Register a transition hook; the name must be declared in the
     *  manifest's `hooks`. Returns an unregister function. */
    on(name: HookName, fn: HookFn): () => void;
  };
  /** Append a payload to a contribution registry; the point must be declared
   *  in the manifest's `points`. Registries are dumb lists the owning
   *  subsystem reads in load order. */
  contribute(point: string, payload: unknown): void;
}

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
