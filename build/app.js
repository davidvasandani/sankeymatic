/*
In & Out front end for SankeyMATIC.

This file connects the page's controls to the engine in sankeymatic.js. It
does not draw anything: rows are written into the engine's text input as
ordinary SankeyMATIC syntax and the engine renders them. Sharing, saving and
exporting are the engine's own functions.

Two views share one diagram:
  'inout' - rows of sources and destinations around one hub (inout-model.js)
  'text'  - the engine's text input, for any other shape
*/

(function inOutApp(glob) {
'use strict';

const M = glob.InOutModel,
  STARTER = 'in_out_budget',
  $ = (id) => document.getElementById(id),
  state = {
    view: 'inout',
    model: M.starterModel(),
    // What fromRender() said about the text view's current diagram:
    convertible: { ok: false, reason: 'no-flows' },
  };

// MARK Small helpers

let toastTimer;
function toast(message) {
  const t = $('toast');
  t.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.textContent = ''; }, 4000);
}

let statusTimer;
// Tell assistive technology about the balance, once typing pauses:
function announce(message) {
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { $('meter_status').textContent = message; }, 700);
}

const measurer = document.createElement('canvas').getContext('2d');

/**
 * Size a text field to the words in it, so that a sentence can run on
 * around it. The stylesheet's max-width still applies.
 * @param {HTMLInputElement} field
 * @param {number} minPx
 */
function fitField(field, minPx) {
  const style = getComputedStyle(field);
  measurer.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const words = measurer.measureText(field.value || field.placeholder || '').width;
  field.style.width = `${Math.max(minPx, Math.ceil(words) + 14)}px`;
}

/** The diagram's number format, as the Options panel has it. */
function numberStyle(places) {
  const [group, decimal] = $('value_format').value;
  return {
    places,
    group: group === 'X' ? '' : group,
    decimal,
    prefix: $('value_prefix').value,
    suffix: $('value_suffix').value,
    trim: !$('labelvalue_fullprecision').checked,
  };
}

// MARK Writing rows into the engine

/** Write the model out as diagram text and have the engine draw it. */
function drawModel() {
  $('flows_in').value = M.toText(state.model);
  glob.process_sankey();
}

// MARK Rows

const SIDES = {
  ins: { box: 'ins', what: 'source', nameLabel: 'Source name' },
  outs: { box: 'outs', what: 'destination', nameLabel: 'Destination name' },
};

function describeRow(entry, row, side) {
  const label = row.name.trim() || `this ${SIDES[side].what}`;
  entry.querySelector('.amt').setAttribute('aria-label', `Amount for ${label}`);
  entry.querySelector('.rm').setAttribute('aria-label', `Remove ${label}`);
}

function buildRow(side, row, index) {
  const entry = document.createElement('div'),
    name = document.createElement('input'),
    amount = document.createElement('input'),
    remove = document.createElement('button'),
    note = document.createElement('p'),
    noteId = `${side}_note_${index}`;

  entry.className = 'entry';
  entry.style.setProperty('--r', index);

  name.className = 'nm';
  name.value = row.name;
  name.autocomplete = 'off';
  name.setAttribute('aria-label', SIDES[side].nameLabel);
  name.setAttribute('aria-describedby', noteId);
  name.addEventListener('input', () => {
    row.name = name.value;
    describeRow(entry, row, side);
    drawModel();
  });

  amount.className = 'amt';
  amount.value = row.amount;
  amount.inputMode = 'decimal';
  amount.autocomplete = 'off';
  amount.placeholder = '0';
  amount.addEventListener('input', () => {
    row.amount = amount.value;
    drawModel();
  });

  remove.type = 'button';
  remove.className = 'rm';
  remove.textContent = '✕';
  remove.addEventListener('click', () => {
    const rows = state.model[side],
      at = rows.indexOf(row);
    rows.splice(at, 1);
    buildSide(side);
    drawModel();
    // Keep the keyboard user's place: the row that moved up, or "Add".
    const next = $(SIDES[side].box).children[at];
    (next ? next.querySelector('.nm')
      : document.querySelector(`[data-add="${side}"]`)).focus();
  });

  note.className = 'row-note';
  note.id = noteId;
  note.hidden = true;

  // Sources read "name, amount"; destinations read "amount, name".
  entry.append(...(side === 'ins' ? [name, amount] : [amount, name]), remove, note);
  describeRow(entry, row, side);
  return entry;
}

function buildSide(side) {
  $(SIDES[side].box).replaceChildren(
    ...state.model[side].map((row, i) => buildRow(side, row, i))
  );
}

/** Fill the In & Out view's fields from the model. */
function buildRows() {
  buildSide('ins');
  buildSide('outs');
  $('hub').value = state.model.hub;
  fitField($('hub'), 110);
  $('rest').value = state.model.rest;
  fitField($('rest'), 48);
  $(`io_colors_${state.model.colors}`).checked = true;
}

/**
 * After a render: say why any row was left out, and give each row the
 * colour its node was drawn in.
 */
function refreshRows(detail) {
  const v = M.validate(state.model),
    drawnColors = new Map(detail.nodes.map((n) => [n.name, n.color]));

  ['ins', 'outs'].forEach((side) => {
    Array.from($(SIDES[side].box).children).forEach((entry, i) => {
      const result = v[side][i],
        reason = M.REASONS[result.problem],
        note = entry.querySelector('.row-note'),
        name = entry.querySelector('.nm');
      note.textContent = reason || '';
      note.hidden = !reason;
      name.setAttribute('aria-invalid', reason ? 'true' : 'false');
      entry.classList.toggle('off', !result.ok);
      entry.style.setProperty(
        '--c',
        result.ok
          ? drawnColors.get(result.name) || M.rowColor(state.model, side, i)
            || 'transparent'
          : 'transparent'
      );
    });
  });

  const hubReason = M.REASONS[v.hubProblem];
  $('hub_note').textContent = hubReason
    ? `${hubReason} The diagram shows “${v.hub}” until it is changed.`
    : '';
  $('hub_note').hidden = !hubReason;
  $('hub').setAttribute('aria-invalid', hubReason ? 'true' : 'false');
  $('inout_empty').hidden = detail.hasFlows;
}

// MARK Balance meter

function refreshMeter() {
  const b = M.balance(state.model),
    v = M.validate(state.model),
    fmt = (n) => M.formatNumber(n, numberStyle(b.places)),
    fill = $('fill');
  let share = 0;
  if (b.totalIn > 0) { share = Math.min(100, (b.totalOut / b.totalIn) * 100); }
  else if (b.totalOut > 0) { share = 100; }

  $('t-in').textContent = fmt(b.totalIn);
  $('t-out').textContent = fmt(b.totalOut);
  fill.style.width = `${share}%`;
  fill.classList.toggle('over', b.state === 'deficit');

  ['surplus', 'balanced', 'deficit'].forEach((s) => {
    $(`verdict_${s}`).hidden = s !== b.state;
  });
  $('left_over').textContent = fmt(b.diff);
  $('short_by').textContent = fmt(b.diff);

  // The remainder cannot be drawn into the hub itself or back into a source:
  const restBlocked = b.state === 'surplus' && v.restProblem;
  $('rest_note').textContent = restBlocked
    ? `${M.REASONS[v.restProblem] || 'That name can’t be used here.'} `
      + 'The left-over amount is not drawn until the name changes.'
    : '';
  $('rest_note').hidden = !restBlocked;
  $('rest').setAttribute('aria-invalid', restBlocked ? 'true' : 'false');

  const totals = `In ${fmt(b.totalIn)}. Out ${fmt(b.totalOut)}. `,
    sentences = {
      surplus: `${fmt(b.diff)} is left over and will be drawn as ${v.rest}.`,
      balanced: 'In and out balance. Nothing is left over.',
      deficit: `You have ${fmt(b.diff)} more going out than coming in. `
        + 'Trim a destination or add a source.',
    };
  announce(totals + sentences[b.state]);
}

// MARK Fitting the diagram into its column

/**
 * The engine draws at the size set under Options. When the column is
 * narrower than that, the diagram is scaled down for display only; the
 * element the engine measures for PNG export keeps its true size.
 */
function fitChart() {
  const chart = $('chart'),
    fit = $('chart_fit'),
    w = parseFloat(chart.style.width) || 600,
    h = parseFloat(chart.style.height) || 600,
    available = $('stage').clientWidth,
    k = available > 0 ? Math.min(1, available / w) : 1;
  chart.style.transform = k < 1 ? `scale(${k})` : '';
  fit.style.width = `${w * k}px`;
  fit.style.height = `${h * k}px`;
}

// MARK Views

const BACK_NOTES = {
  'no-flows': 'Write a flow to draw a diagram.',
  issues: 'Fix the problems listed above the diagram, then In & Out can open it.',
  name: 'A name in this diagram can’t be used in a row (one that starts '
    + 'with a colon or an apostrophe, for example), so it is edited here.',
  amount: 'An amount in this diagram is written in a way rows can’t '
    + 'hold, so it is edited here.',
  other: 'In & Out needs sources, one hub and destinations. This diagram has '
    + 'another shape, so it is edited here. To start over with In & Out, pick '
    + 'Budget under Other shapes.',
  inexact: 'In & Out can open this, but it will rewrite the text: nodes are '
    + 'drawn in row order, and a “left over” flow is added or removed so the '
    + 'hub balances.',
  exact: 'This diagram fits In & Out.',
};

function refreshBackButton(detail) {
  const result = M.fromRender(detail);
  let note = BACK_NOTES.other;
  if (result.ok) {
    note = result.exact ? BACK_NOTES.exact : BACK_NOTES.inexact;
  } else if (BACK_NOTES[result.reason]) {
    note = BACK_NOTES[result.reason];
  }
  state.convertible = result;
  $('btn_back_inout').disabled = !result.ok;
  $('back_note').textContent = note;
}

function setView(view) {
  const inout = view === 'inout';
  state.view = view;
  $('board').dataset.view = view;
  ['col_in', 'col_out', 'hub_box', 'meter', 'io_colors_box'].forEach((id) => {
    $(id).hidden = !inout;
  });
  $('col_text').hidden = inout;
  if (inout) { $('inout_empty').hidden = true; }
  $('btn_text_mode').disabled = !inout;
  // The column's width has changed:
  fitChart();
}

/**
 * Show a diagram that has just arrived (at load, from a file, or from a
 * sample): as rows when it is exactly that shape, otherwise as text.
 * The diagram's text is left as it came.
 */
function adopt(detail) {
  const result = M.fromRender(detail);
  if (result.ok && result.exact) {
    state.model = result.model;
    buildRows();
    setView('inout');
  } else {
    setView('text');
  }
  refresh(detail);
}

/** Bring everything outside the diagram up to date with a render. */
function refresh(detail) {
  // Slider readouts (values may have come from a link, file or sample):
  document.querySelectorAll('#skm_form input[type="range"]').forEach((r) => {
    if ($(`${r.id}_val`)) { glob.updateOutput(r.id); }
  });
  fitChart();
  if (state.view === 'inout') {
    refreshRows(detail);
    refreshMeter();
  } else {
    refreshBackButton(detail);
  }
}

// MARK Header: copy link, download menu, options panel

async function copyLink() {
  const link = glob.skmShareLink();
  try {
    await navigator.clipboard.writeText(link);
    toast('Link copied. It holds the whole diagram, numbers included.');
  } catch (err) {
    // No clipboard access (an insecure origin, or permission refused):
    $('link_text').value = link;
    $('link_dialog').showModal();
    $('link_text').select();
  }
}

function setMenu(open) {
  $('download_menu').hidden = !open;
  $('btn_download').setAttribute('aria-expanded', String(open));
}

function setPanel(open) {
  $('options_panel').hidden = !open;
  $('board').dataset.options = open ? 'open' : 'closed';
  $('btn_options').setAttribute('aria-expanded', String(open));
  // The diagram's column has changed width:
  fitChart();
  if (open) { $('options_close').focus(); } else { $('btn_options').focus(); }
}

function wireHeader() {
  $('btn_link').addEventListener('click', copyLink);

  $('btn_download').addEventListener('click', () => {
    setMenu($('download_menu').hidden);
  });
  document.querySelectorAll('[data-png]').forEach((b) => {
    b.addEventListener('click', () => {
      glob.saveDiagramAsPNG(Number(b.dataset.png));
      setMenu(false);
    });
  });
  $('save_as_svg').addEventListener('click', () => {
    glob.saveDiagramAsSVG();
    setMenu(false);
  });
  $('save_text').addEventListener('click', () => {
    glob.saveDiagramToFile();
    setMenu(false);
  });
  // Clicking anywhere else closes the menu:
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-wrap')) { setMenu(false); }
  });

  $('btn_options').addEventListener('click', () => {
    setPanel($('options_panel').hidden);
  });
  $('options_close').addEventListener('click', () => setPanel(false));

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') { return; }
    if (!$('download_menu').hidden) {
      setMenu(false);
      $('btn_download').focus();
    } else if (!$('options_panel').hidden
        && !document.querySelector('dialog[open]')) {
      setPanel(false);
    }
  });
}

// MARK Options panel: the engine's settings

function wireOptions() {
  const form = $('skm_form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    glob.process_sankey();
  });

  form.querySelectorAll('input, select').forEach((field) => {
    if (field.type === 'hidden' || 'io' in field.dataset) { return; }
    // Some controls only make sense with a particular radio selected, so
    // using them selects it (e.g. picking a single colour):
    const implied = field.dataset.check,
      apply = () => {
        if (implied) { glob.checkRadio(implied); }
        glob.process_sankey();
      };
    field.addEventListener('change', apply);
    if (field.type === 'range') {
      field.addEventListener('input', () => {
        glob.updateOutput(field.id);
        apply();
      });
    }
  });

  form.querySelectorAll('.nudge').forEach((b) => {
    b.addEventListener('click', () => {
      glob.nudgeColorTheme(b.dataset.theme, Number(b.dataset.move));
    });
  });

  // Row colours belong to the In & Out view, not to the engine's settings:
  form.querySelectorAll('input[name="io_colors"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      state.model.colors = radio.value;
      // "The default node colours" with no theme chosen would turn every
      // row grey, so pick the first theme:
      if (radio.value === 'theme' && $('node_theme_none').checked) {
        glob.checkRadio('theme_a_radio');
      }
      drawModel();
    });
  });

  const resetButton = $('reset_all_moved_nodes');
  resetButton.addEventListener('click', () => {
    glob.resetMovesAndRender();
  });
  // Dragging a node does not redraw the diagram, so there is no render to
  // hear about. The engine does enable this button, though; show the hint
  // around it whenever it is usable:
  new MutationObserver(() => {
    $('reset_moves_area').hidden = resetButton.disabled;
  }).observe(resetButton, { attributes: true, attributeFilter: ['disabled'] });
}

// MARK Other shapes: samples, files, the text view

function warningShowing() {
  return $('replace_graph_warning').style.display !== 'none';
}

function afterImport() {
  adopt(glob.skmLastRender);
  $('shapes_dialog').close();
}

function wireShapes() {
  const dialog = $('shapes_dialog'),
    fileInput = $('load_diagram_from_file');

  $('btn_shapes').addEventListener('click', () => {
    glob.hideReplaceGraphWarning();
    dialog.showModal();
  });

  dialog.querySelectorAll('[data-sample]').forEach((b) => {
    b.addEventListener('click', () => {
      // The engine either loads the sample at once, or (when there is work
      // to lose) shows its warning and waits for a yes:
      glob.replaceGraph(b.dataset.sample);
      if (warningShowing()) {
        $('replace_graph_yes').focus();
      } else {
        afterImport();
      }
    });
  });
  $('replace_graph_yes').addEventListener('click', () => {
    glob.replaceGraphConfirmed();
    afterImport();
  });
  $('replace_graph_no').addEventListener('click', () => {
    glob.hideReplaceGraphWarning();
  });

  $('btn_open_file').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    if (!fileInput.files.length) { return; }
    await glob.loadDiagramFile();
    // Allow the same file to be chosen again later:
    fileInput.value = '';
    afterImport();
  });

  $('btn_text_mode').addEventListener('click', () => {
    setView('text');
    refresh(glob.skmLastRender);
    dialog.close();
    $('flows_in').focus();
  });

  $('btn_back_inout').addEventListener('click', () => {
    const result = state.convertible;
    if (!result.ok) { return; }
    state.model = result.model;
    buildRows();
    setView('inout');
    if (result.exact) {
      refresh(glob.skmLastRender);
    } else {
      // The rows and the text disagree about the leftover; rows win.
      drawModel();
    }
    $('hub').focus();
  });

  // The text view edits the engine's input directly, as the stock page did:
  $('flows_in').addEventListener('change', () => glob.process_sankey());
  $('flows_in').addEventListener('keyup', () => glob.debounced_process_sankey());

  // Dialogs: close buttons, and a click on the backdrop.
  document.querySelectorAll('dialog').forEach((d) => {
    d.querySelectorAll('[data-close]').forEach((b) => {
      b.addEventListener('click', () => d.close());
    });
    d.addEventListener('click', (e) => { if (e.target === d) { d.close(); } });
  });
}

// MARK The In & Out view's own fields

function wireInOut() {
  document.querySelectorAll('[data-add]').forEach((b) => {
    b.addEventListener('click', () => {
      const side = b.dataset.add;
      state.model[side].push({ name: '', amount: '', color: null, flow: null });
      buildSide(side);
      refreshRows(glob.skmLastRender);
      $(SIDES[side].box).lastElementChild.querySelector('.nm').focus();
    });
  });

  $('hub').addEventListener('input', () => {
    state.model.hub = $('hub').value;
    fitField($('hub'), 110);
    drawModel();
  });

  $('rest').addEventListener('input', () => {
    state.model.rest = $('rest').value;
    fitField($('rest'), 48);
    drawModel();
  });
}

// MARK Start

function start() {
  wireHeader();
  wireOptions();
  wireShapes();
  wireInOut();

  document.addEventListener('skm:render', (e) => refresh(e.detail));
  new ResizeObserver(fitChart).observe($('stage'));

  // The engine has already drawn whatever the address asked for. With no
  // diagram in the address, open on the budget example:
  const fromLink = new URLSearchParams(glob.location.search).has('i');
  if (!fromLink && $('flows_in').value === '') {
    glob.replaceGraph(STARTER);
  }
  glob.hideReplaceGraphWarning();
  adopt(glob.skmLastRender);

  // The two fitted fields were measured in a fallback font if the page's
  // own fonts had not arrived yet:
  document.fonts.ready.then(() => {
    fitField($('hub'), 110);
    fitField($('rest'), 48);
  });
}

start();
}(window));
