'use strict';
// The Claude Code agent provider: who runs sessions, and the text a session is
// sent when it starts in each stage.
//
// This contribution used to be three COMMAND LINES (`claude /prepare
// {card.md}`) beside three file paths. Grid never ran the command lines — it
// owns the agent process and talks to it over its own transport — and nothing
// read the files, so the Settings page that edited them changed nothing while
// the text that mattered sat hard-coded in ide/engine/sessions.js. What a
// provider actually owes the host is the WORDING, so that is what it now
// contributes.
//
// One entry per stage where Grid starts or resumes an agent. `default` is the
// shipped text; `file` is the workspace-relative path a user may keep their own
// copy at. The host's precedence is: a workspace edit in Settings › SDLC,
// then that file if it exists, then this default — so shipping better wording
// here reaches every workspace that has not deliberately changed it. Grid never
// writes these files. See ide/engine/stageprompts.js.
const PROMPTS = [
  {
    stage: 'prepare',
    name: '/prepare',
    title: 'Prepare',
    file: '.claude/commands/prepare.md',
    usedBy: 'inbox -> prepare',
    default: `Refine the task per the pipeline protocol in your session context.

Read the card body and investigate the code before you write anything down. Ask clarifying questions with the AskUserQuestion tool — the picker renders right here in this session and is answered here, so ask when two readings of the card would lead to materially different work.

Rewrite the card body into a concrete, verifiable plan in plain language, keeping the frontmatter intact. Then ask ONE final "Ready to build" question and wait for the answer. Do not start building until it is approved.`,
  },
  {
    stage: 'start',
    name: '/start',
    title: 'Start (no prepare stage)',
    file: '.claude/commands/start.md',
    usedBy: 'inbox -> doing',
    default: `Start this card per the pipeline protocol in your session context — your type has no prepare stage, so there is no plan to write and no approval to wait for.

Read the card, investigate, do the work, and write what you find into the card body as you go. Use the AskUserQuestion tool only when a real choice comes up that would change the outcome; make the routine calls yourself.

When the work is done, write the "## Review" section the protocol describes and move the card to the state it names.`,
  },
  {
    stage: 'build',
    name: '/build',
    title: 'Build',
    file: '.claude/commands/build.md',
    usedBy: 'prepare -> doing',
    default: `Continue building this card per its plan.

Work the plan in the card body, one phase at a time, and keep the card's task list current as you go — between your messages it is the only signal of what you are doing. Run the project's own build and test commands as you finish each phase: a phase is done when its checks pass, not when the code is written.

If the plan turns out to be wrong, say so and adjust it in the card body rather than silently doing something else. When the implementation is complete, write the "## Review" section the pipeline protocol describes, set the status it names, and stop there.`,
  },
  {
    stage: 'review',
    name: '/self-review',
    title: 'Self-review',
    file: '.claude/commands/self-review.md',
    usedBy: 'doing -> review',
    default: `This card is in review and is waiting on the user, not on you — do not restart the work and do not move the card.

Read the card, its "## Review" section and the current diff. Say in a sentence or two where the work stands and what is waiting on the user, then stop.

If the "## Review" section is missing, or describes something the diff does not, correct that section — and only that section — so the person reading it sees what really changed.`,
  },
  {
    stage: 'deliver',
    name: '/deliver',
    title: 'Deliver',
    file: '.claude/commands/deliver.md',
    usedBy: 'review -> deliver',
    default: `Deliver this card per the deliver stage in your session context: ship it, then watch the pipeline through to completion and fix what you can — a failing lint, a flaky job, a bad config are yours here.

Follow this thread's delivery policy for what has to be asked first. Never merge and never deploy further than the policy allows; both of those are the user's.

Record what shipped under "### Delivery" in the card's "## Review" section: the PR/MR URL, the pipeline's verdict, and which environments the deploy actually reached. If the pipeline stays red and you cannot fix it, set the card back to review with the reason under "### Needs your eyes".`,
  },
  {
    stage: 'verify',
    name: '/verify',
    title: 'Verify',
    file: '.claude/commands/verify.md',
    usedBy: 'deliver -> closed',
    default: `Verify this card per the verify stage in your session context. Verifying means proving the change works where it runs: restart the affected service or app so it picks up the change, then drive the changed feature end-to-end in the real UI. Tests alone do not count. Run the thread verification command when one is configured.

A step this machine cannot run at all — driving a browser with no Claude in Chrome pairing is the usual one — is SKIPPED. A skip is neither a pass nor a failure: verify everything that does not need it, record the step that did not run on its own line as \`browser: skipped\` with the reason, and never fold it into a pass.

Record the outcome under "### Verification" in the card's "## Review" section: pass, fail or skipped per step, plus one line of the evidence you actually saw.

Only when nothing failed do you move the card on as the pipeline protocol says. On failure keep it in verify, put the failure under "### Needs your eyes", and stop for the user to decide the next move. A skip on its own is not a failure and does not hold the card.`,
  },
];

const PROVIDER = {
  id: 'claude',
  name: 'Claude (Claude Code)',
  bin: 'claude',
  prompts: PROMPTS,
};

function activate(context) {
  context.contribute('agent.provider', PROVIDER);
  // llm.provider is declared but not contributed yet: no subsystem reads that
  // point until the model pickers move behind it — a payload today would be
  // an untested claim.
}

module.exports = { activate, PROVIDER, PROMPTS };
