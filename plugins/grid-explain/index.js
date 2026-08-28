'use strict';
// Ownership stub: the explain subsystem itself (ide/engine/explain.js in
// core) stays in core until the follow-up card moves it behind this point.
const EXPLAIN = {
  id: 'grid-explain',
  description: 'The code view’s file summaries and inline notes, and which model writes them.',
};

function activate(context) {
  context.contribute('file.explain', EXPLAIN);
}

module.exports = { activate, EXPLAIN };
