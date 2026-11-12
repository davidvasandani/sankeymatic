/*
In & Out model
The logic behind the "In & Out" view: sources on one side, one hub, and
destinations on the other.

This file has no DOM access. It turns the view's rows into SankeyMATIC's text
syntax (toText), and decides whether a diagram the engine has just parsed can
be shown as rows (fromRender). The engine in sankeymatic.js stays the only
parser and the only renderer.

Loaded in the browser as window.InOutModel and in tests via require().
*/

(function inOutModel(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.InOutModel = api;
  }
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  // Row colours, taken in order. Greens for what comes in, rusts and ochres
  // for what goes out.
  const IN_COLORS = ['#2f6f4f', '#6fa287', '#9cc2ad', '#487f64'],
    OUT_COLORS = [
      '#b5532f', '#d98a4e', '#c9a13c', '#8f6a4b', '#a4472f', '#d6b27a',
      '#7a5b3c',
    ],
    HUB_COLOR = '#1d2b23',
    REST_COLOR = '#2f6f4f',
    DEFAULT_HUB = 'Hub',
    DEFAULT_REST = 'Left over',

    // A name ending like this would be read by the engine as a flow's color
    // (and/or opacity) rather than as part of the name: "Team #123", "x #".
    reColorTail = /\s#(?:[a-f0-9]{3,6})?(?:\.\d{1,4})?$/i,
    // The only color form a ':Name #color' line can carry:
    reHexColor = /^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i,

    // Why a row is left out of the diagram, in the user's terms:
    REASONS = {
      brackets: 'Square brackets can’t be used in a name.',
      prefix: 'A name can’t start with //, an apostrophe or a colon.',
      colortail: 'A name can’t end in something that reads as a colour, like #123.',
      hub: 'This is the name of the hub, so it can’t also be a row.',
      otherside: 'This name is already used under “Coming in”.',
    };

  /**
   * Read an amount as typed. Commas and spaces are treated as digit grouping.
   * @param {string|number} raw
   * @returns {{value: number, text: string, places: number}|null} null when
   *  the field is blank or is not a plain non-negative number
   */
  function parseAmount(raw) {
    const cleaned = String(raw ?? '').replace(/[,\s]/g, '');
    if (!/^(?:\d+\.?\d*|\.\d+)$/.test(cleaned)) { return null; }
    // Normalize '5.' to '5' and '.5' to '0.5' for the engine:
    let text = cleaned.replace(/\.$/, '');
    if (text.startsWith('.')) { text = `0${text}`; }
    const value = Number(text);
    if (!Number.isFinite(value)) { return null; }
    return { value, text, places: (text.split('.')[1] || '').length };
  }

  /**
   * @param {string} name already trimmed
   * @param {boolean} isTarget true when the name will appear after an [amount]
   * @returns {string|null} a key of REASONS, 'empty', or null when usable
   */
  function nameProblem(name, isTarget) {
    if (name === '') { return 'empty'; }
    if (/[[\]]/.test(name)) { return 'brackets'; }
    if (/^(?:\/\/|'|:)/.test(name)) { return 'prefix'; }
    if (isTarget && reColorTail.test(name)) { return 'colortail'; }
    return null;
  }

  function trimmed(s) { return String(s ?? '').trim(); }

  /**
   * Work out which rows can be drawn, and under which names.
   * @param {object} model
   * @returns {object} { hub, hubProblem, rest, restProblem, ins[], outs[] }
   *  where ins/outs entries are { ok, name, amount, problem }
   */
  function validate(model) {
    const hubTyped = trimmed(model.hub),
      hubIssue = nameProblem(hubTyped, true),
      // The diagram is still drawn while the hub's name is being retyped:
      hub = hubIssue ? DEFAULT_HUB : hubTyped,
      hubProblem = hubIssue && hubIssue !== 'empty' ? hubIssue : null,
      sourceNames = new Set();

    function check(row, isTarget) {
      const name = trimmed(row.name),
        parsed = parseAmount(row.amount),
        amount = parsed || { value: 0, text: '0', places: 0 };
      let problem = nameProblem(name, isTarget);
      if (!problem && name === hub) { problem = 'hub'; }
      if (!problem && isTarget && sourceNames.has(name)) {
        problem = 'otherside';
      }
      return { ok: !problem, name, amount, problem };
    }

    const ins = (model.ins || []).map((r) => {
        const result = check(r, false);
        if (result.ok) { sourceNames.add(result.name); }
        return result;
      }),
      outs = (model.outs || []).map((r) => check(r, true)),
      restTyped = trimmed(model.rest),
      rest = restTyped === '' ? DEFAULT_REST : restTyped;

    let restProblem = nameProblem(rest, true);
    if (!restProblem && rest === hub) { restProblem = 'hub'; }
    if (!restProblem && sourceNames.has(rest)) { restProblem = 'otherside'; }

    return { hub, hubProblem, rest, restProblem, ins, outs };
  }

  /**
   * Compare what comes in with what goes out, over the rows that are drawn.
   * Sums are rounded at the precision of the amounts typed, so that
   * 0.1 + 0.2 balances against 0.3.
   * @param {object} model
   * @returns {object} { totalIn, totalOut, diff, places, state }
   *  state is 'surplus' (in > out), 'balanced' or 'deficit' (out > in)
   */
  function balance(model) {
    const v = validate(model),
      drawn = v.ins.concat(v.outs).filter((r) => r.ok),
      places = drawn.reduce((p, r) => Math.max(p, r.amount.places), 0),
      scale = 10 ** places,
      round = (n) => Math.round(n * scale) / scale,
      sum = (rows) => round(
        rows.filter((r) => r.ok).reduce((s, r) => s + r.amount.value, 0)
      ),
      totalIn = sum(v.ins),
      totalOut = sum(v.outs),
      diff = round(totalIn - totalOut);
    let state = 'balanced';
    if (diff > 0) { state = 'surplus'; }
    if (diff < 0) { state = 'deficit'; }
    return { totalIn, totalOut, diff: Math.abs(diff), places, state };
  }

  /**
   * The color a row is drawn in, or null when the engine should choose.
   * @param {object} model
   * @param {'ins'|'outs'} side
   * @param {number} index
   * @returns {string|null}
   */
  function rowColor(model, side, index) {
    const row = model[side][index];
    if (row && row.color) { return row.color; }
    if (model.colors !== 'rows') { return null; }
    const palette = side === 'ins' ? IN_COLORS : OUT_COLORS;
    return palette[index % palette.length];
  }

  /**
   * Write the model as SankeyMATIC input text.
   * @param {object} model
   * @returns {string}
   */
  function toText(model) {
    const v = validate(model),
      flows = [],
      colorLines = [],
      colored = new Set();

    function addColor(name, color) {
      if (!color || colored.has(name)) { return; }
      colored.add(name);
      colorLines.push(`:${name} ${color}`);
    }

    function suffix(row) { return row.flow ? ` ${row.flow}` : ''; }

    v.ins.forEach((r, i) => {
      if (!r.ok) { return; }
      flows.push(`${r.name} [${r.amount.text}] ${v.hub}${suffix(model.ins[i])}`);
      addColor(r.name, rowColor(model, 'ins', i));
    });
    const insDrawn = flows.length;
    if (insDrawn) { flows.push(''); }

    let outsDrawn = 0;
    v.outs.forEach((r, i) => {
      if (!r.ok) { return; }
      outsDrawn += 1;
      flows.push(`${v.hub} [${r.amount.text}] ${r.name}${suffix(model.outs[i])}`);
      addColor(r.name, rowColor(model, 'outs', i));
    });

    if (!insDrawn && !outsDrawn) { return ''; }

    const usesPalette = model.colors === 'rows';
    if (balance(model).state === 'surplus' && !v.restProblem) {
      flows.push(
        `${v.hub} [*] ${v.rest}${model.restFlow ? ` ${model.restFlow}` : ''}`
      );
      addColor(v.rest, model.restColor || (usesPalette ? REST_COLOR : null));
    }
    addColor(v.hub, model.hubColor || (usesPalette ? HUB_COLOR : null));

    // Drop a trailing blank line (when there are sources but nothing else):
    while (flows.length && flows[flows.length - 1] === '') { flows.pop(); }
    return colorLines.length
      ? `${flows.join('\n')}\n\n${colorLines.join('\n')}`
      : flows.join('\n');
  }

  function sameColor(a, b) {
    return String(a).toLowerCase() === String(b).toLowerCase();
  }

  /**
   * Decide whether a diagram the engine has parsed can be shown as rows.
   * @param {object} detail what sankeymatic.js publishes after a render:
   *  { hasFlows, issues, reversed, nodes, flows }
   * @returns {object} { ok: true, exact, model } or { ok: false, reason }.
   *  'exact' is false when writing the model back as text would change the
   *  diagram (a leftover amount with no "[*]" flow, or the reverse).
   */
  function fromRender(detail) {
    const no = (reason) => ({ ok: false, reason });
    if (!detail || !detail.hasFlows) { return no('no-flows'); }
    if (detail.issues) { return no('issues'); }

    const nodes = detail.nodes.filter((n) => !n.isAShadow),
      flows = detail.flows.filter((f) => !f.isAShadow).map((f) => {
        // 'Reverse the graph' swaps each flow's ends and its calculation
        // symbol. Undo that, to get back to what the input said:
        const swap = Boolean(detail.reversed),
          flipped = { '*': '?', '?': '*' };
        return {
          source: swap ? f.target : f.source,
          target: swap ? f.source : f.target,
          operation: swap && f.operation ? flipped[f.operation] : f.operation,
          value: f.value,
          suffix: f.inputSuffix || null,
        };
      });

    // Presentation details which rows have no way to express:
    const unsupported = nodes.some((n) => {
      const given = n.fromInput || {};
      return given.opacity || given.label || given.paint || n.hideWholeLabel
        || (given.color && !reHexColor.test(n.color));
    });
    if (unsupported) { return no('node-feature'); }

    // The hub is the one node which both receives and sends:
    const sources = new Set(flows.map((f) => f.source)),
      both = nodes.filter((n) => sources.has(n)
        && flows.some((f) => f.target === n));
    if (both.length === 0) { return no('no-hub'); }
    if (both.length > 1) { return no('not-one-hub'); }
    const hub = both[0];
    // Every flow must have the hub at exactly one end:
    if (flows.some((f) => (f.source === hub) === (f.target === hub))) {
      return no('not-one-hub');
    }

    const inFlows = flows.filter((f) => f.target === hub),
      outFlows = flows.filter((f) => f.source === hub),
      restFlows = outFlows.filter((f) => f.operation === '*');
    if (inFlows.some((f) => f.operation)) { return no('calculated-in'); }
    if (outFlows.some((f) => f.operation === '?')) { return no('fill-missing'); }
    if (restFlows.length > 1) { return no('two-remainders'); }

    const explicit = (n) => (n.fromInput && n.fromInput.color ? n.color : null),
      toRow = (f, end) => ({
        name: f[end].name,
        amount: String(f.value),
        color: explicit(f[end]),
        flow: f.suffix,
      }),
      restFlow = restFlows[0],
      model = {
        hub: hub.name,
        rest: restFlow ? restFlow.target.name : DEFAULT_REST,
        restFlow: restFlow ? restFlow.suffix : null,
        restColor: restFlow ? explicit(restFlow.target) : null,
        hubColor: explicit(hub),
        colors: 'theme',
        ins: inFlows.map((f) => toRow(f, 'source')),
        outs: outFlows.filter((f) => f !== restFlow)
          .map((f) => toRow(f, 'target')),
      };

    // Was this diagram using the In & Out palette? It was if every row has
    // a color of its own. A row whose color is the palette's color for its
    // position goes back to being automatic.
    const rows = model.ins.concat(model.outs);
    if (rows.length && rows.every((r) => r.color)) {
      model.colors = 'rows';
      ['ins', 'outs'].forEach((side) => {
        const palette = side === 'ins' ? IN_COLORS : OUT_COLORS;
        model[side].forEach((r, i) => {
          if (sameColor(r.color, palette[i % palette.length])) { r.color = null; }
        });
      });
      if (model.hubColor && sameColor(model.hubColor, HUB_COLOR)) {
        model.hubColor = null;
      }
      if (model.restColor && sameColor(model.restColor, REST_COLOR)) {
        model.restColor = null;
      }
    }

    // Would writing this model back out draw the same diagram?
    const v = validate(model),
      allDrawn = v.ins.concat(v.outs).every((r) => r.ok) && !v.hubProblem,
      surplus = balance(model).state === 'surplus',
      exact = allDrawn && surplus === Boolean(restFlow)
        && !(restFlow && v.restProblem);
    return { ok: true, exact, model };
  }

  /**
   * Format a total the way the diagram formats its values.
   * @param {number} n
   * @param {object} style { places, group, decimal, prefix, suffix, trim }
   * @returns {string}
   */
  function formatNumber(n, style = {}) {
    const places = style.places || 0,
      group = style.group ?? ',',
      decimal = style.decimal ?? '.';
    let [whole, fraction = ''] = Math.abs(n).toFixed(places).split('.');
    if (style.trim) { fraction = fraction.replace(/0+$/, ''); }
    whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
    return `${style.prefix || ''}${n < 0 ? '-' : ''}${whole}`
      + `${fraction ? decimal + fraction : ''}${style.suffix || ''}`;
  }

  /** @returns {object} the budget the page opens with */
  function starterModel() {
    const row = (name, amount) => ({ name, amount, color: null, flow: null });
    return {
      hub: 'Budget',
      rest: 'Savings',
      restFlow: null,
      restColor: null,
      hubColor: null,
      colors: 'rows',
      ins: [row('Wages', '1500'), row('Other', '250')],
      outs: [
        row('Taxes', '450'), row('Housing', '420'), row('Food', '400'),
        row('Transportation', '255'), row('Other Necessities', '160'),
      ],
    };
  }

  return {
    IN_COLORS,
    OUT_COLORS,
    HUB_COLOR,
    REST_COLOR,
    DEFAULT_REST,
    REASONS,
    parseAmount,
    validate,
    balance,
    rowColor,
    toText,
    fromRender,
    formatNumber,
    starterModel,
  };
}));
