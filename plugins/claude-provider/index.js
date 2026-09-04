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
//
// FIVE OF THESE ARE THE 2026-08-30 DESIGN EXPORT, TRANSCRIBED. `SDPROMPT` in
// design/Grid Alpha.dc.html is the source for prepare, build, review, deliver
// and verify — keyed there by transition (INBOX>PREPARE, PREPARE>DOING,
// DOING>REVIEW, REVIEW>DELIVER, DELIVER>VERIFY), which is how they map onto
// these stage names. Four of the five are byte-identical to it. `start` has no
// arrow on the design's rail and therefore no entry in SDPROMPT; it keeps its
// own wording because a research or chore card still starts somewhere.
//
// A CLOSING PARAGRAPH ADDED 2026-08-31 to prepare, review and deliver — the
// only stages an agent can be exiting when the card crosses a HANDOFF ARROW
// (server/handoff.js): Prepare -> Doing and any arrow into Verify replace the
// agent, on every route, unconditionally now, instead of that depending on
// worktree isolation or which button moved the card. Each paragraph says
// plainly whether the agent finishing this stage is the one that continues —
// review's is conditional, because whether its own exit hands off depends on
// the thread's own delivery policy (deliver first, or straight to verify).
const PROMPTS = [
  {
    stage: 'prepare',
    name: '/prepare',
    title: 'Prepare',
    file: '.claude/commands/prepare.md',
    usedBy: 'inbox -> prepare',
    default: `Refine this card into a plan the user can approve. Read the card body and investigate the code before you write anything down.
Decide the size first. A small card — a few files, a change you can describe in two sentences, no design decision, no schema or API change, no new dependency — is \`difficulty: easy\`: write that into the frontmatter (the person can change it back), write only "### Summary", "### What I will change" and "### Expected files I will touch", and set \`status: doing\` yourself. No "Ready to build" question and no approval wait: the plan is the diff. When in doubt it is not small, and the rest of this message applies.

Ask clarifying questions with the AskUserQuestion tool — the picker renders here and is answered here, so ask whenever two readings of the card would lead to materially different work. Record every question and its answer in the card under "### Questions asked".

Rewrite the card body, keeping the frontmatter intact, so it carries these sections, plus any Grid asks for further down this message:
- "### Summary": what this card is, in two or three sentences a stranger could follow.
- "### What I will change": the behaviour that will be different afterwards, not the files.
- "### How I will know it works": the check that proves it, named concretely.
- "### Requires your attention": anything the user must decide or accept. Empty is a good outcome.
- "### Expected files I will touch": the files you expect to edit, and one line on anything shared.
- "### Related cards": every open card this one depends on, blocks, follows up on, or shares files with. Closed cards do not belong here.
- "### List of tasks": the ordered steps, in the format below. Doing works from it.

Write the task list as one markdown checkbox per line, in the order you will do them, each a single action with a verifiable end: "- [ ] Add the limiter middleware to the public router". Five to twelve is normal. Keep the card the size of the ask: the plan delivers what the card asks and nothing more, and anything you notice on the way that it did not ask for — a default worth changing, a neighbouring bug, a refactor — goes under "### Related cards" as a follow-up to file, not into the task list. A card whose list passes twelve tasks or whose files span more than three areas (engine, UI, CLI and docs count separately) is more than one card: offer the masterplan split as the recommended option in the "Ready to build" question. The Doing agent works this list top to bottom and ticks each line as it lands, so no sub-bullets, no prose lines between them, and no step that means several unrelated things.

Otherwise, ask ONE final "Ready to build" question and wait. Do not start building until it is approved.

Approval hands the card on: to a fresh agent when Doing wants another model or runs in another directory (a worktree), otherwise to you, in this conversation. Write the plan as if a stranger will build it either way — the card is the record the next stage reads.`,
  },
  {
    stage: 'start',
    name: '/start',
    title: 'Start (no prepare stage)',
    file: '.claude/commands/start.md',
    usedBy: 'inbox -> doing',
    default: `Work this card per the pipeline protocol in your session context — your type has no prepare stage, so there is no plan to follow, no approved task list, and no approval to wait for.

You are sent this message when the card starts and again whenever it is picked back up, so read the card first, including anything you already wrote into it: the card body is the only record of how far the work got. Carry on from there rather than starting again.

Investigate, do the work, and write what you find into the card body as you go. Use the AskUserQuestion tool only when a real choice comes up that would change the outcome; make the routine calls yourself.

When the work is done, write the "## Review" section the protocol describes and move the card to the state it names.`,
  },
  {
    stage: 'build',
    name: '/build',
    title: 'Build',
    file: '.claude/commands/build.md',
    usedBy: 'prepare -> doing',
    default: `Continue building this card per its plan.

Work the approved task list in order, one task at a time, and tick each line in the card the moment its checks pass — "- [x]". Between your messages that list is the only signal of what you are doing, so it has to be true at all times: never tick ahead, and never leave a finished task open.

The list is fixed at approval. If the work needs a step that is not on it, add the line and say plainly that you are adding it — it shows up in Review as a deviation from the plan. Do not renumber or silently rewrite the list. A card sent back from review comes with its findings written into the task list as open "Review finding" rows: fix those and nothing else — a finding you disagree with is answered in the review's Needs-your-eyes list rather than reworked around, and anything else you notice goes to the follow-up card Grid names, not into this diff.

As you finish each task, run the tests of the files and packages you changed, and nothing wider: a task is done when those pass, not when the code is written. The whole suite, a browser and a scratch service are Verify’s job, not yours.

If the plan turns out to be wrong, say so and adjust it in the card body rather than quietly doing something else. When every task is ticked, write the "## Review" section the pipeline protocol describes, set the status it names, and stop there — unless the card is \`difficulty: easy\`, where review is a pass, not a stop: record each test you ran and its result under "### Checks" in "## Review" and, if all passed, move the card on to the stage your session context names in the same turn.`,
  },
  {
    stage: 'review',
    name: '/self-review',
    title: 'Self-review',
    file: '.claude/commands/self-review.md',
    usedBy: 'doing -> review',
    default: `This card is in review. Unless it is \`difficulty: easy\`, it is waiting on the user, not on you — do not restart the work and do not move the card. An easy card is passing through: if every line under "### Checks" passed, move it on yourself to the stage your session context names; if one failed, fix it or ask the user with AskUserQuestion.

Read the card, its "## Review" section and the current diff, then make that section worth reading in thirty seconds.

"### What changed": what the diff actually does, in plain sentences, not a file list.

"### Assumptions": every judgement you made that the plan did not settle for you. One line each: what you assumed, and what happens if you were wrong. Leave out anything the plan already decided, and write "none" rather than padding the list.

"### Needs your eyes": what a person has to look at, worst first. Start every line with a marker — [critical] could lose data, break production or expose something; [important] wrong behaviour, a missing case, or a decision you were not entitled to make; [minor] worth knowing, safe to ignore — then one short sentence on what to look at and why it matters. Nothing routine belongs here: an empty section is a good outcome.

If the "## Review" section describes something the diff does not, correct that section — and only that section — so the person reading it sees what really changed.

What approval does next depends on this thread's delivery policy, and your session context says which. Into Deliver it keeps YOU — the next message names that stage's own work rather than restarting the conversation. Into Verify it hands the card to a fresh agent when that stage wants another model or runs in another directory, otherwise to you — the message that arrives says which — and the "## Review" section you leave behind is what that stage reads first.`,
  },
  {
    stage: 'deliver',
    name: '/deliver',
    title: 'Deliver',
    file: '.claude/commands/deliver.md',
    usedBy: 'review -> deliver',
    default: `Deliver this card per the deliver stage in your session context: ship it, then watch the pipeline through to completion and fix what you can — a failing lint, a flaky job, a bad config are yours here.

Follow this thread's delivery policy for what has to be asked first. Never merge and never deploy further than the policy allows; both of those are the user's.

Record what shipped under "### Delivery" in the card's "## Review" section: the PR/MR URL, the pipeline's verdict, and which environments the deploy actually reached. If the pipeline stays red and you cannot fix it, do not move the card. Write what failed and why under "### Delivery failed", then ask the user with the AskUserQuestion tool what to do about that specific failure: fix it, ship without it, or leave it and carry on. Offer the options the failure actually allows, not a generic pair.

Moving the card on hands it to Verify: a fresh agent when that stage wants another model or directory, otherwise you. Either way, whatever Verify needs to know about what shipped belongs in "### Delivery", not in this conversation.`,
  },
  // THE ONE PROMPT THAT IS NOT THE EXPORT VERBATIM. The design's DELIVER>VERIFY
  // predates the skip ruling: it runs three paragraphs and knows only pass and
  // fail. Its new escalation is adopted here — "### Verification failed" plus a
  // question instead of a silent stall — but the SKIPPED paragraph and the two
  // skip-aware clauses stay, because dropping them would revert a behaviour the
  // operator ruled gets built rather than softened. The export's "Only on pass
  // move the card on" becomes "only when nothing failed" for the same reason: a
  // skip is not a pass, and the export's sentence would hold every card that
  // legitimately skipped a step.
  {
    stage: 'verify',
    name: '/verify',
    title: 'Verify',
    file: '.claude/commands/verify.md',
    usedBy: 'deliver -> verify',
    default: `Verify this card per the verify stage in your session context. Verifying means proving the change works where it runs, scoped to what changed: \`git diff --name-only <base>...HEAD\` says what the diff touches. Restart or start a scratch instance of a service only when the diff touches that service; drive the changed feature end-to-end in the real UI only when it touches UI code — for a UI change, tests alone do not count. Run the thread verification command when one is configured; on an easy card run the tests of the packages the diff touches instead of the whole suite.

A step this machine cannot run at all — driving a browser with no Claude in Chrome pairing is the usual one — is SKIPPED. A skip is neither a pass nor a failure: verify everything that does not need it, record the step that did not run on its own line as \`browser: skipped\` with the reason, and never fold it into a pass.

Record the outcome under "### Verification" in the card's "## Review" section: pass, fail or skipped per step, plus one line of the evidence you actually saw.

Only when nothing failed do you move the card on as the pipeline protocol says. On failure keep it in verify, write what failed under "### Verification failed", and ask the user with the AskUserQuestion tool what to do about that failure: fix it, accept it, or roll the change back. Offer the options the failure actually allows. A skip on its own is not a failure and does not hold the card. Findings the adversarial review raised and the user accepted at approve are the user's decision: verify the change, and do not re-open the review or fail the card over them.`,
  },
];

const PROVIDER = {
  id: 'claude',
  name: 'Claude (Claude Code)',
  bin: 'claude',
  // A reference to the manifest's own `permissions.spawn`, never a restatement
  // of it — core's contributionRefusal drops a payload that names a spawn its
  // manifest does not declare, or one that disagrees with it. `spawn: true` is
  // how a contribution says "start me the way my manifest says" without a
  // second, unsigned copy of the block a person never saw before installing.
  //
  // Core still DISPATCHES `claude` down its own bespoke path; declaring the
  // contract here is what makes the declared path capable of running it, and
  // switching the dispatch over is a separate change on purpose, so that a bad
  // merge of either half stays recoverable.
  spawn: true,
  prompts: PROMPTS,
};

function activate(context) {
  context.contribute('agent.provider', PROVIDER);
  // llm.provider is declared but not contributed yet: no subsystem reads that
  // point until the model pickers move behind it — a payload today would be
  // an untested claim.
}

module.exports = { activate, PROVIDER, PROMPTS };
