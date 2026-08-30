'use strict';

// Keep this contribution declarative: the host owns the PTY and process
// lifecycle; the provider describes the Codex CLI surface it should launch.
const PROVIDER = {
  id: 'codex',
  name: 'Codex (Codex CLI)',
  bin: 'codex',
  commands: [
    { name: '/prepare', file: '.codex/prompts/prepare.md', usedBy: 'inbox -> prepare' },
    { name: '/build', file: '.codex/prompts/build.md', usedBy: 'prepare -> doing' },
    { name: '/self-review', file: '.codex/prompts/self-review.md', usedBy: 'doing -> review' },
  ],
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

module.exports = { activate, PROVIDER };
