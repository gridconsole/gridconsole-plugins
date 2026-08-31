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

// THIS GATE AND CORE'S PARSER MUST AGREE ABOUT WHAT A HEADING IS.
//
// The gate decides whether a card may enter review; core's review.js decides
// what the review panel then draws. Wherever the two read a heading differently
// the product tells the user two things at once, and both of the ways they can
// disagree are bad. A heading the gate accepts and the parser does not means the
// card sails through the contract check into a panel that renders it blank; a
// heading the parser accepts and the gate does not means a refusal the card
// visibly satisfies. Changing one without the other re-opens that seam.
//
// Two rounds of trying to keep the two in agreement BY DESCRIBING THE SAME RULE
// TWICE both failed, in the same direction, and left seventeen shapes where the
// gate passed a card the panel drew blank. Paraphrase is what kept losing: the
// gate said "any heading from ## to ####", core said "###"; the gate trimmed the
// space before a suffix with String.trim(), which strips twenty-two more
// codepoints than core's `[ \t]` and waves an ordinary NBSP paste straight
// through; the gate matched line-anchored with `/m`, where U+2028 ends a line,
// while core matches `\n` and it does not; and the gate read the WHOLE card
// where core reads only the last `## Review` block, so a `### What changed`
// under `## Plan` satisfied a contract about a section the panel never looks at.
//
// So this is no longer a description of core's rules. It is core's rules: the
// same SUFFIX string, the same two regexes, the same last-wins scan, run over
// the same region. A sandboxed plugin cannot import from the engine, so it is a
// deliberate second copy — the same call, and for the same reason, as maskFences
// below. Both move together or neither moves.
//
// review.js SUFFIX, verbatim. The separator is REQUIRED and it is a closed set
// of punctuation, so "### What changed later" is a different section from
// "### What changed" — core depends on that to keep "### Delivery failed" apart
// from "### Delivery", and a gate that accepts the loose form passes a card core
// reads as neither.
const SUFFIX = '[ \\t]*(?:[—–·(:-][^\\n]*)?';

// review.js `section()`'s sentinel: the terminator is a lookahead for the next
// heading, so the last section of a block needs one to stop at.
const END = '\n## __END__';

// A ```-fenced region is a PICTURE of the contract, not the contract.
//
// A card that documents what an agent must write quotes these exact headings
// inside a fence, and a matcher that cannot see the fence reads the example as
// the real thing: the gate then passes a card whose only "## Review" is a
// worked example, and the panel — core's review.js skips fences — draws nothing.
//
// Masking keeps the string's length and every newline where they were, so the
// line-anchored patterns above and below behave identically on the masked copy.
// An unterminated fence is deliberately left as prose, the same call core makes:
// mis-skipping would let one stray backtick run refuse a fully written card.
//
// This is a deliberate second copy of core's review.js `maskFences`. A plugin is
// sandboxed and cannot import from the engine, and the alternative — the two
// matchers reading fences differently — is the exact class of defect this whole
// block exists to prevent. They move together.
function maskFences(text) {
  const lines = text.split('\n');
  const out = lines.slice();
  let open = null; // { char, len, line } of the fence we are inside
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (open) {
      // A closing fence is the same character, at least as long, and bare.
      if (m[1][0] !== open.char || m[1].length < open.len || m[2].trim() !== '') continue;
      for (let j = open.line; j <= i; j++) out[j] = ' '.repeat(lines[j].length);
      open = null;
      continue;
    }
    // A ```-fence's info string cannot itself contain a backtick.
    if (m[1][0] === '`' && m[2].includes('`')) continue;
    open = { char: m[1][0], len: m[1].length, line: i };
  }
  return out.join('\n');
}

/** review.js `lastMatch`: newest wins, because a re-reviewed card carries one
 *  `## Review` block per round and the current one is the last. */
function lastMatch(re, scan) {
  let m, last = null;
  while ((m = re.exec(scan)) !== null) last = m;
  return last;
}

/**
 * The LAST `## Review` block of a fence-masked card, or null — review.js
 * `parseReview`'s block matcher, verbatim, run on the masked copy.
 *
 * THE REGION MATTERS AS MUCH AS THE HEADING. This gate used to scan the whole
 * card, and core has never read anything but this block: a `### What changed`
 * under `## Plan`, one below the review block, or one that only ever existed in
 * an EARLIER round all satisfied the contract while the panel showed nothing,
 * because the panel was not looking there. Asking about the same region core
 * will read is what makes the answer mean anything.
 *
 * The masked copy keeps the original's length and every newline, so group 1 is
 * the masked twin of exactly the slice core takes from the real text — headings
 * quoted inside a ```-fence are spaces in it, and nothing else moved.
 */
function reviewBlock(masked) {
  const re = new RegExp(`(?:^|\\n)##[ \\t]+Review${SUFFIX}(?=\\n)([\\s\\S]*?)(?=\\n##\\s|$)`, 'gi');
  const m = lastMatch(re, masked);
  return m ? m[1] : null;
}

/** Whether a `### <heading>` exists in this block — review.js `section()`'s
 *  regex, verbatim, asked for the match rather than for the body.
 *
 *  Presence, NOT content: the shipped review prompt tells the agent in so many
 *  words that an empty `### Needs your eyes` is a good outcome, so a gate that
 *  demanded text under the heading would refuse the card that got it right. */
function hasSection(maskedBlock, heading) {
  const re = new RegExp(
    `(?:^|\\n)###[ \\t]+${heading}${SUFFIX}(?=\\n)([\\s\\S]*?)(?=\\n###\\s|\\n##\\s)`,
    'gi',
  );
  return lastMatch(re, maskedBlock + END) !== null;
}

/**
 * What the Review contract is missing from this body, in contract order.
 * Exported so the gate's behavior is testable without a ctx or a file.
 */
function missingReviewSections(body) {
  // Line endings first, because everything below wants a literal `\n` and core's
  // parser normalises the same way. A CRLF card used to pass this gate and then
  // return null from parseReview — a contract check waving a card through to a
  // panel that could not read a single heading on it.
  const masked = maskFences(String(body || '').replace(/\r\n?/g, '\n'));
  const block = reviewBlock(masked);
  if (block === null) return ['Review'];
  return REVIEW_SECTIONS.filter((name) => !hasSection(block, name));
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
