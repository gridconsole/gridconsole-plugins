'use strict';
// The default seven-stage SDLC as data: the design's transition table
// (Grid Alpha, SDLCR) verbatim. Each row is one arrow — from, to, what
// triggers it, what runs, what must hold, and which plugin owns the run.
const STAGES = [
  { f: 'INBOX', t: 'PREPARE', trig: 'when you file it with Prepare', cmd: '/prepare', ver: 'contract: summary present', plug: 'claude-provider' },
  { f: 'PREPARE', t: 'DOING', trig: 'on your plan approve', cmd: '/build', ver: 'contract: plan approved by you', plug: 'claude-provider' },
  { f: 'DOING', t: 'REVIEW', trig: 'agent declares done', cmd: '/self-review', ver: 'lint clean · task list complete', plug: 'claude-provider' },
  { f: 'REVIEW', t: 'DELIVER', trig: 'your review approve', cmd: 'git commit && gh pr create --fill', ver: 'app starts locally · you approved', plug: 'github-deliver' },
  { f: 'DELIVER', t: 'VERIFY', trig: 'automatic', cmd: '', ver: 'PR open · CI green', plug: 'github-deliver' },
  { f: 'VERIFY', t: 'CLOSE', trig: 'on green', cmd: 'grid memory write {outcome}', ver: 'suite green · nothing else broke', plug: '' },
  { f: 'CLOSE', t: '', trig: 'card done', cmd: '', ver: 'memory written · docs updated', plug: '' },
];

// ---------------------------------------------------------------------------
// The Review contract.
//
// A card leaves Doing when its Review section is actually written. These five
// subsections are the ones the engine TELLS the agent to write (core's
// sessions.js, the "add a ## Review section" instruction) and the ones core's
// review.js parses — so they are the only list that is already true of the
// product. The docs and the Settings chips advertise a different, longer set
// (Summary, What I will change, …) that no card in any real workspace carries;
// enforcing that list would refuse every card ever written. Collapsing the two
// vocabularies into one is a separate job, and until it happens the gate holds
// cards to what they were asked for, not to what the brochure says.
const REVIEW_SECTIONS = ['Needs your eyes', 'Assumptions', 'What changed', 'Files touched', 'Branch'];

// `## Review`, and the suffixed forms people really write: "## Review · 2026-08-24",
// "## Review (round 2)", "## Review — the alpha cut". The separator is required
// so this does not match a prose heading that merely starts with the word, e.g.
// '## Review sections + "Approve review" = POST /api/card/approve'.
const REVIEW_HEAD = /^##[ \t]+Review[ \t]*(?:[—·(:-][^\n]*)?$/im;

/** The section headings a body carries, at any depth. Case-insensitive, and
 *  ## / ### agnostic: real cards use both, and core's own corpus writes
 *  "## Verification" far more often than "### Verification". */
function headings(body) {
  const out = new Set();
  const re = /^#{2,4}[ \t]+([^\n]+?)[ \t]*$/gm;
  let m;
  while ((m = re.exec(body)) !== null) out.add(m[1].toLowerCase());
  return out;
}

/**
 * What the Review contract is missing from this body, in contract order.
 * Exported so the gate's behavior is testable without a ctx or a file.
 */
function missingReviewSections(body) {
  const text = String(body || '');
  if (!REVIEW_HEAD.test(text)) return ['Review'];
  const have = headings(text);
  return REVIEW_SECTIONS.filter((name) => {
    const want = name.toLowerCase();
    // A suffix after the heading is fine here too ("### Branch — main").
    for (const h of have) {
      if (h === want || h.startsWith(`${want} `) || h.startsWith(`${want}\t`)) return false;
      if (h.startsWith(want) && /^[—·(:-]/.test(h.slice(want.length).trim())) return false;
    }
    return true;
  });
}

/**
 * before:review — the first stage contract Grid actually runs.
 *
 * Note what this can and cannot do. A block only reverts a move GRID makes:
 * your drag, the stage menu, an approval. When the agent writes `status:
 * review` into the card itself — which is how most of this arrow really
 * happens — the watcher sees it after the write landed, and the same verdict
 * is recorded as advisory instead. So this reads as a refusal to you and as a
 * note to the agent, which is the seam's ceiling, not this hook's choice.
 *
 * `contract: off` in a card's frontmatter opts it out. Cards close as bare
 * prose sometimes — parked, ceded, answered by a decision — and a stage rule
 * that cannot be waived is a trap rather than a contract.
 */
/** The card's content, wherever this host put it.
 *
 *  A sandboxed plugin gets it nested on the card, because that is the shape
 *  the host serializes across the process boundary (pluginhost.js cardMove).
 *  A plugin loaded in-process (GRID_PLUGIN_INPROC=1) gets the engine's own
 *  hook ctx, which carries it at the top level. Both are real, so read both —
 *  guessing one would make this gate refuse every card under the other. */
function content(ctx) {
  const card = ctx.card || {};
  const body = card.body !== undefined ? card.body : ctx.body;
  const fm = card.frontmatter !== undefined ? card.frontmatter : ctx.frontmatter;
  return { body: typeof body === 'string' ? body : '', frontmatter: fm || {} };
}

function reviewGate(ctx) {
  const { body, frontmatter } = content(ctx);
  if (String(frontmatter.contract || '').toLowerCase() === 'off') return;
  const missing = missingReviewSections(body);
  if (!missing.length) return;
  // Two different sentences, because "add the missing Review section — Review —"
  // is what one template produces when the whole section is what is missing.
  const whole = missing.length === 1 && missing[0] === 'Review';
  ctx.block({
    reason: `Review contract: ${whole ? 'no "## Review" section' : `missing ${missing.join(', ')}`}`,
    fix: whole
      ? `Add a "## Review" section to the card with: ${REVIEW_SECTIONS.join(', ')} — then move it again.`
      : `Add the missing Review ${missing.length === 1 ? 'section' : 'sections'} — ${missing.join(', ')} — under the card's "## Review" heading, then move it again.`,
  });
}

// ---------------------------------------------------------------------------
// The stage contracts: what a card must carry, stage by stage.
//
// The design's `stageCfg` fixture, and until now a hardcoded constant in core
// (settingsModel.ts STAGE_CONTRACTS) rendered directly under the STAGES table
// this plugin already contributes. That was the visible version of the defect
// `card.section` exists to fix: switch this plugin off and the table above
// emptied while the card below kept drawing all seven stages.
//
// Colour is deliberately NOT in the payload. Core derives it from the stage
// name through stageTone(), whose order is the one and only place the
// --ob-sN slot per stage is decided, so a workflow and its contracts cannot
// disagree about what colour REVIEW is.
//
// Chip kinds: sec (plain section) · auto (system-provided) · on/off (a setting
// pair) · ok (check-style) · ghost (dashed add-affordance).
const ch = (label, kind = 'sec') => ({ label, kind });

const CONTRACTS = [
  {
    stage: 'INBOX',
    scope: 'Captured, not started. Nothing runs; the card waits for you or a rule.',
    chips: [ch('no contract: just a queue', 'auto')],
  },
  {
    stage: 'PREPARE',
    scope: 'Refines the card until it is pickable. It asks its questions here; you answer and edit.',
    chips: [
      ch('Summary'), ch('What I will change'), ch('How I will know it works'),
      ch('Requires your attention'), ch('Expected files I will touch'),
      ch('List of tasks → agent tasks in Doing'), ch('Asked questions, with your answers'),
      ch('+ add section', 'ghost'),
    ],
  },
  {
    stage: 'DOING',
    scope: 'Builds. The card is the live progress report while the agent works.',
    chips: [
      ch('Summary'), ch('Changes so far'), ch('Changes still to do'),
      ch('Task list · ✓ as they finish'), ch('Requires your attention'),
      ch('+ add section', 'ghost'),
    ],
  },
  {
    // NOTE: these chips are the DOCUMENTED contract, and they are not the one
    // that runs. reviewGate above holds before:review to REVIEW_SECTIONS, the
    // five the engine actually asks the agent for and review.js parses. The
    // two vocabularies now sit in one file for the first time, which is what
    // makes collapsing them a later edit rather than a later archaeology; it
    // is deliberately NOT collapsed here, because changing what the gate
    // refuses is a behaviour change and this contribution is a wiring change.
    stage: 'REVIEW',
    scope: 'Everything Prepare promised and Doing did, side by side. The app is started locally, port on the card.',
    chips: [
      ch('All Prepare + Doing sections', 'auto'), ch('✓ what is done'),
      ch('⚠ changed from the original plan'), ch('Requires your attention'),
      ch('review: per change', 'on'), ch('review: all at once', 'off'),
      ch('start the app locally · show port', 'ok'), ch('+ add section', 'ghost'),
    ],
  },
  {
    stage: 'DELIVER',
    scope: 'Creates the delivery as configured, and reports back with the link.',
    chips: [
      ch('deliver by: pull request', 'on'), ch('merge request', 'off'),
      ch('push to branch', 'off'), ch('report: link + summary on the card', 'auto'),
    ],
  },
  {
    stage: 'VERIFY',
    scope: 'Checks the delivery landed and nothing around it broke.',
    chips: [
      ch('PR merged', 'ok'), ch('deploy green', 'ok'),
      ch('regression sweep over the rest', 'ok'), ch('+ add check', 'ghost'),
    ],
  },
  {
    stage: 'CLOSE',
    scope: 'Wraps up: memory written, documentation updated, one last conflict check.',
    chips: [
      ch('write memory'), ch('update docs'), ch('final conflict check'),
      ch('+ add step', 'ghost'),
    ],
  },
];

function activate(context) {
  context.contribute('sdlc.workflow', { stages: STAGES });
  context.contribute('card.section', { stages: CONTRACTS });
  // before:review is the contract above, and it is the manifest's
  // `requireSections` that decides whether it runs at all. Read from
  // context.settings, which the host resolves from the workspace and hands
  // over at activation; the default is true, so a workspace that has never
  // touched the setting behaves exactly as it did before this was wired.
  //
  // The hook is not REGISTERED when the setting is off, rather than registered
  // and short-circuiting inside reviewGate. A gate that runs and always passes
  // still shows up as this plugin's hook on every move; not registering means
  // the arrow genuinely has no contract on it, which is what "off" says.
  //
  // A change to the value re-activates this plugin (pluginhost.setSettings),
  // so this runs again and the registration follows the setting live.
  //
  // before:deliver stays declared and unregistered: its row reads "app starts
  // locally · you approved", and nothing in the engine can observe either of
  // those, so a gate there would be a guess wearing a rule's clothes.
  const settings = context.settings || {};
  if (settings.requireSections !== false) context.hooks.on('before:review', reviewGate);
}

module.exports = { activate, STAGES, CONTRACTS, reviewGate, missingReviewSections, REVIEW_SECTIONS };
