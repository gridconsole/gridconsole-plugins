'use strict';
// The four built-in themes as data. Ids match the UI's THEMES vocabulary
// (ide/ui/src/theme.ts), labels the design's picker names — the token blocks
// themselves stay in the UI's stylesheet until themes ship as tokens.
const THEMES = [
  { id: 'grid', label: 'Grid dark' },
  { id: 'dusk', label: 'Dusk' },
  { id: 'light', label: 'Grid light' },
  { id: 'hc', label: 'High contrast' },
];

function activate(context) {
  context.contribute('theme.register', THEMES);
}

module.exports = { activate, THEMES };
