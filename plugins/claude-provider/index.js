'use strict';
// The Claude Code agent provider: who runs sessions, and the per-stage
// commands the default SDLC's first three arrows invoke. Command names and
// files match the design's command list (Grid Alpha, CMDL).
const PROVIDER = {
  id: 'claude',
  name: 'Claude (Claude Code)',
  bin: 'claude',
  commands: [
    { name: '/prepare', file: '.claude/commands/prepare.md', usedBy: 'inbox -> prepare' },
    { name: '/build', file: '.claude/commands/build.md', usedBy: 'prepare -> doing' },
    { name: '/self-review', file: '.claude/commands/self-review.md', usedBy: 'doing -> review' },
  ],
};

function activate(context) {
  context.contribute('agent.provider', PROVIDER);
  // llm.provider is declared but not contributed yet: no subsystem reads that
  // point until the model pickers move behind it — a payload today would be
  // an untested claim.
}

module.exports = { activate, PROVIDER };
