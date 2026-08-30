'use strict';

// Keep this contribution declarative: the host owns the PTY and process
// lifecycle; the provider describes the Codex CLI surface it should launch,
// and the wording its sessions are started with.

// One entry per stage where Grid starts or resumes an agent. The host's
// precedence is a workspace edit in Settings › SDLC, then `file` if it
// exists on disk, then `default` — so shipping better wording here reaches
// every workspace that has not deliberately changed it. Grid never writes
// these files. See ide/engine/stageprompts.js.
//
// THIS IS NOT A TRANSLATION OF THE CLAUDE TEXT, and the difference is the
// point. Grid launches Codex with `--approve-for-me` inside a workspace-write
// sandbox: execution is already authorized before the first message lands. Text
// that reads as a request for permission ("may I proceed?") makes Codex stop
// and ask for something nobody is waiting to grant, so every prompt here says
// out loud that it may act, and reserves asking for real product decisions.
// There is no AskUserQuestion tool on this provider either — a question is a
// message in the conversation.
const PROMPTS = [
  {
    stage: 'prepare',
    name: '/prepare',
    title: 'Prepare',
    file: '.codex/prompts/prepare.md',
    usedBy: 'inbox -> prepare',
    default: `Refine the task per the pipeline protocol in your session context.

Read the card body and investigate the code before you write anything down. You are already authorized to read, run commands and edit files in this workspace — do not ask for permission to look around, and do not ask whether you may continue.

Rewrite the card body into a concrete, verifiable plan in plain language, keeping the frontmatter intact. Ask the user in the conversation only when two readings of the card would lead to materially different work; decide the routine calls yourself and say which way you went.

When the plan is written, ask once whether it is ready to build, and wait. That single question is the only approval gate in this stage — do not start building before it is answered.`,
  },
  {
    stage: 'start',
    name: '/start',
    title: 'Start (no prepare stage)',
    file: '.codex/prompts/start.md',
    usedBy: 'inbox -> doing',
    default: `Start this card per the pipeline protocol in your session context — your type has no prepare stage, so there is no plan to write and no approval to wait for.

Read the card, investigate, do the work, and write what you find into the card body as you go. You are already authorized to run commands and edit files in this workspace; work straight through rather than checking in for permission.

Ask the user only when a real choice comes up that would change the outcome. When the work is done, write the "## Review" section the protocol describes and move the card to the state it names.`,
  },
  {
    stage: 'build',
    name: '/build',
    title: 'Build',
    file: '.codex/prompts/build.md',
    usedBy: 'prepare -> doing',
    default: `Continue building this card per its plan.

The plan in the card body is approved and you are authorized to carry it out: edit files and run this project's build and test commands without asking first. Work one phase at a time and treat a phase as done when its checks pass, not when the code is written.

If the plan turns out to be wrong, say so and adjust it in the card body rather than silently doing something else. When the implementation is complete, write the "## Review" section the pipeline protocol describes, set the status it names, and stop there.`,
  },
  {
    stage: 'review',
    name: '/self-review',
    title: 'Self-review',
    file: '.codex/prompts/self-review.md',
    usedBy: 'doing -> review',
    default: `This card is in review and is waiting on the user, not on you — do not restart the work and do not move the card.

Read the card, its "## Review" section and the current diff. Say in a sentence or two where the work stands and what is waiting on the user, then stop.

If the "## Review" section is missing, or describes something the diff does not, correct that section — and only that section — so the person reading it sees what really changed.`,
  },
  {
    stage: 'deliver',
    name: '/deliver',
    title: 'Deliver',
    file: '.codex/prompts/deliver.md',
    usedBy: 'review -> deliver',
    default: `Deliver this card per the deliver stage in your session context: ship it, then watch the pipeline through to completion and fix what you can — a failing lint, a flaky job, a bad config are yours here.

This thread's delivery policy in your session context is the authority on what needs asking. Where it authorizes an action, take it without a further check-in; where it says ask, ask. Never merge and never deploy further than the policy allows — both of those are the user's.

Record what shipped under "### Delivery" in the card's "## Review" section: the PR/MR URL, the pipeline's verdict, and which environments the deploy actually reached. If the pipeline stays red and you cannot fix it, set the card back to review with the reason under "### Needs your eyes".`,
  },
  {
    stage: 'verify',
    name: '/verify',
    title: 'Verify',
    file: '.codex/prompts/verify.md',
    usedBy: 'deliver -> closed',
    default: `Verify this card per the verify stage in your session context. Verifying means proving the change works where it runs: restart the affected service or app so it picks up the change, then drive the changed feature end-to-end for real. Tests alone do not count. Run the thread verification command when one is configured.

Starting the app, restarting a service and exercising the feature are all authorized — do them rather than asking whether you should.

A step this machine cannot run at all — driving a browser with no Claude in Chrome pairing is the usual one — is SKIPPED. A skip is neither a pass nor a failure: verify everything that does not need it, record the step that did not run on its own line as \`browser: skipped\` with the reason, and never fold it into a pass.

Record the outcome under "### Verification" in the card's "## Review" section: pass, fail or skipped per step, plus one line of the evidence you actually saw. Only when nothing failed do you move the card on as the pipeline protocol says. On failure keep it in verify, put the failure under "### Needs your eyes", and stop for the user to decide the next move. A skip on its own is not a failure and does not hold the card.`,
  },
];

const PROVIDER = {
  id: 'codex',
  name: 'Codex (Codex CLI)',
  bin: 'codex',
  prompts: PROMPTS,
  capabilities: {
    nonInteractive: true,
    jsonl: true,
    resume: true,
    chat: 'experimental',
    terminal: true,
  },
  invocation: {
    run: ['exec', '--json', '--sandbox', 'workspace-write', '-'],
    resume: ['exec', 'resume', '{sessionId}', '-'],
  },
  // The host may use this interactive transport when the provider is selected.
  // The app-server owns the conversation; the TUI is only the native renderer.
  interactive: {
    mode: 'terminal',
    // Let Codex decide when a command needs to leave the workspace sandbox.
    // This keeps ordinary work automatic while allowing local services and
    // other restricted operations to reach the approval prompt.
    approvalPolicy: 'on-request',
    // Let Codex's automatic reviewer handle those requests without stopping
    // the operator in the terminal.
    autoApprove: true,
    protocol: 'codex-app-server-v2',
    server: ['app-server', '--listen', '{endpoint}'],
    tui: ['--remote', '{endpoint}'],
    items: ['thread', 'items', 'list'],
  },
};

function activate(context) {
  context.contribute('agent.provider', PROVIDER);
}

module.exports = { activate, PROVIDER, PROMPTS };
