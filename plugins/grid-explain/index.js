'use strict';
// Ownership stub: the explain subsystem itself (ide/engine/explain.js in
// core) stays in core until the follow-up card moves it behind this point.
//
// It is also, since the `invoke` message kind landed, the first plugin that
// puts a row in the code view's right-click menu and a command in the keymap
// table — and the first whose contribution DOES something rather than naming
// something. Two contributions describe the row and the command; the function
// behind them stays in this process and is reached by id.
//
// What that function may do is bounded by this manifest and nothing else:
// network [], filesystem [], shell false. So it does not summarise the
// selection — it cannot reach a model, and pretending otherwise would be the
// defect this whole card is about, one layer along. It answers with what it
// WOULD do and on what: the span, the size, the enclosing symbol read out of
// the text it was handed, and the model this workspace has configured. That
// last part is the point of the demonstration — change `model` in Settings ›
// Plugins and the answer changes, which is the whole chain (a setting, a child
// process, a command, a route, a pixel) reporting for duty in one sentence.
const EXPLAIN = {
  id: 'grid-explain',
  description: 'The code view’s file summaries and inline notes, and which model writes them.',
};

const COMMAND = 'grid-explain:describe-selection';

/** The row in the code view's right-click menu, under FROM PLUGINS.
 *
 *  `when` is a static word the renderer resolves against what is true at click
 *  time. It has to be static: a contribution crosses to the host once, at
 *  activation, so this payload cannot ask whether anything is selected. The
 *  renderer knows; this only says what to ask. */
const MENU = [{ command: COMMAND, label: '✦ Describe this selection', when: 'selection' }];

/** The same command in the keymap table. No accelerator: a contributed command
 *  arrives unbound and the operator gives it a key, so a plugin can never
 *  quietly claim a chord Grid already answers. */
const KEYS = [{ command: COMMAND, label: 'Describe the selection', group: 'view', when: 'selection' }];

/** The last identifier that reads like a declaration, scanning backwards from
 *  the top of the selection. Deliberately a heuristic and deliberately named
 *  as one in the answer — this plugin has no parser and no language server,
 *  and a guess presented as a fact is the thing to avoid. */
const DECL_RE = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var|def|fn|type|interface)\s+([A-Za-z_$][\w$]*)/g;

function enclosingName(text) {
  let last = '';
  let m;
  DECL_RE.lastIndex = 0;
  while ((m = DECL_RE.exec(text)) !== null) last = m[1];
  return last;
}

/**
 * What the code view prints in its footer when you pick the row or press the
 * key. One sentence, because one sentence is what the strip holds.
 */
function describeSelection(args, settings) {
  const rel = typeof args.rel === 'string' ? args.rel : '';
  const selection = typeof args.selection === 'string' ? args.selection : '';
  const line = Number.isFinite(args.line) ? args.line : 0;
  if (!selection) return { note: 'nothing is selected — select some lines and try again' };

  const lines = selection.split('\n').length;
  const span = lines === 1 ? `line ${line || 1}` : `lines ${line || 1}–${(line || 1) + lines - 1}`;
  const name = enclosingName(selection);
  const model = settings.model || 'haiku';
  const notes = settings.inlineNotes === false ? 'off' : 'on';
  const where = rel ? ` of ${rel}` : '';
  const what = name ? `, around \`${name}\`` : '';
  return {
    note: `${span}${where}${what} — ${selection.length} chars, ${lines} ${lines === 1 ? 'line' : 'lines'}`
      + ` · would summarise with ${model}, inline notes ${notes}`,
    // The structured form beside the sentence, so a later surface that wants
    // more than a strip of text does not need this to change shape.
    rel, line, lines, chars: selection.length, symbol: name, model, inlineNotes: notes === 'on',
  };
}

function activate(context) {
  context.contribute('file.explain', EXPLAIN);
  context.contribute('editor.contextMenu', MENU);
  context.contribute('keymap.command', KEYS);
  // The settings snapshot is taken at activation; the host re-activates this
  // plugin when a value changes, so reading it here and closing over it is
  // exactly as live as reading it per call would be.
  const settings = context.settings || {};
  context.commands.register(COMMAND, (args) => describeSelection(args || {}, settings));
}

module.exports = { activate, EXPLAIN, MENU, KEYS, COMMAND, describeSelection, enclosingName };
