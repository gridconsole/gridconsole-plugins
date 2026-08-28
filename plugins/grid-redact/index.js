'use strict';
// Ownership stub: the obfuscation rules problem reports apply stay in core
// until the follow-up card moves them behind this point.
const REDACTOR = {
  id: 'grid-redact',
  description: 'Obfuscation applied to problem reports before you send one.',
};

function activate(context) {
  context.contribute('report.redactor', REDACTOR);
}

module.exports = { activate, REDACTOR };
