'use strict';
// What Deliver means when the target is GitHub. The action string is the
// REVIEW -> DELIVER command of the design's transition table (SDLCR), so the
// two stay one fact.
const TARGET = {
  id: 'github',
  name: 'GitHub',
  action: 'git commit && gh pr create --fill',
};

function activate(context) {
  context.contribute('deliver.target', TARGET);
}

module.exports = { activate, TARGET };
