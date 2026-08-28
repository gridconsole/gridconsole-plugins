'use strict';
// Ownership stub: the accounting itself (ide/engine/insights.js + usage.js in
// core) stays in core until the follow-up card moves it behind this point.
const REPORTER = {
  id: 'grid-usage',
  description: 'Token and cost accounting behind Insights.',
};

function activate(context) {
  context.contribute('usage.reporter', REPORTER);
}

module.exports = { activate, REPORTER };
