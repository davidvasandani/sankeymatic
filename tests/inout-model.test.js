'use strict';

const test = require('node:test'),
  assert = require('node:assert/strict'),
  M = require('../build/inout-model.js'),
  { renderDetail, detailFromText, loadConstants } = require('./fixtures.js');

const { sampleDiagramRecipes } = loadConstants();

function row(name, amount, extra = {}) {
  return { name, amount, color: null, flow: null, ...extra };
}

function model(ins, outs, extra = {}) {
  return {
    hub: 'Budget',
    rest: 'Savings',
    colors: 'theme',
    ins: ins.map((r) => row(...r)),
    outs: outs.map((r) => row(...r)),
    ...extra,
  };
}

// MARK parseAmount

test('parseAmount reads plain numbers and digit grouping', () => {
  assert.deepEqual(M.parseAmount('1500'), { value: 1500, text: '1500', places: 0 });
  assert.deepEqual(M.parseAmount('1,500.50'), { value: 1500.5, text: '1500.50', places: 2 });
  assert.deepEqual(M.parseAmount(' 2 000 '), { value: 2000, text: '2000', places: 0 });
  assert.deepEqual(M.parseAmount('.5'), { value: 0.5, text: '0.5', places: 1 });
  assert.deepEqual(M.parseAmount('5.'), { value: 5, text: '5', places: 0 });
  assert.deepEqual(M.parseAmount(42), { value: 42, text: '42', places: 0 });
});

test('parseAmount refuses blanks, words, negatives and symbols', () => {
  ['', '   ', 'abc', '-5', '1e3', '*', '?', '1.2.3', '.', '$5'].forEach((raw) => {
    assert.equal(M.parseAmount(raw), null, `"${raw}"`);
  });
  assert.equal(M.parseAmount(null), null);
  assert.equal(M.parseAmount(undefined), null);
});

// MARK balance

test('balance: more coming in than going out is a surplus', () => {
  const b = M.balance(M.starterModel());
  assert.equal(b.totalIn, 1750);
  assert.equal(b.totalOut, 1685);
  assert.equal(b.diff, 65);
  assert.equal(b.state, 'surplus');
});

test('balance: equal totals are balanced', () => {
  const b = M.balance(model([['Wages', '100']], [['Rent', '60'], ['Food', '40']]));
  assert.equal(b.state, 'balanced');
  assert.equal(b.diff, 0);
});

test('balance: more going out than coming in is a deficit', () => {
  const b = M.balance(model([['Wages', '100']], [['Rent', '90'], ['Food', '50']]));
  assert.equal(b.state, 'deficit');
  assert.equal(b.diff, 40);
});

test('balance compares at the precision typed, not in binary floats', () => {
  const b = M.balance(model([['a', '0.1'], ['b', '0.2']], [['c', '0.3']]));
  assert.equal(b.state, 'balanced');
  assert.equal(b.places, 1);
  assert.equal(b.totalIn, 0.3);
});

test('balance leaves out rows that are not drawn', () => {
  const b = M.balance(model(
    [['Wages', '100'], ['', '900'], ['Bad [x]', '900']],
    [['Rent', '60'], ['Budget', '500']]
  ));
  assert.equal(b.totalIn, 100);
  assert.equal(b.totalOut, 60);
});

test('balance counts a named row with no amount as zero', () => {
  const b = M.balance(model([['Wages', '100'], ['Bonus', '']], [['Rent', 'lots']]));
  assert.equal(b.totalIn, 100);
  assert.equal(b.totalOut, 0);
});

// MARK validate

test('validate explains why a row is left out', () => {
  const v = M.validate(model(
    [['Wages', '1'], ['A [1] B', '1'], ['// note', '1'], ["'quoted", '1'],
      [':colon', '1'], ['Budget', '1'], ['', '1'], ['Team #123', '1']],
    [['Rent', '1'], ['Wages', '1'], ['Team #123', '1'], ['Item #2', '1'],
      ['Budget', '1'], ['odd #', '1']]
  ));
  assert.deepEqual(
    v.ins.map((r) => r.problem),
    [null, 'brackets', 'prefix', 'prefix', 'prefix', 'hub', 'empty', null]
  );
  assert.deepEqual(
    v.outs.map((r) => r.problem),
    // 'Team #123' is also a source above, but its tail is reported first
    [null, 'otherside', 'colortail', null, 'hub', 'colortail']
  );
  Object.keys(M.REASONS).forEach((k) => assert.ok(M.REASONS[k].length > 10));
});

test('validate: a destination ending in a colour-like tail is refused', () => {
  const v = M.validate(model([['Wages', '1']], [['Team #abc', '1'], ['x #.5', '1']]));
  assert.deepEqual(v.outs.map((r) => r.problem), ['colortail', 'colortail']);
});

test('validate falls back to a placeholder hub while the name is unusable', () => {
  assert.equal(M.validate(model([], [], { hub: '  ' })).hub, 'Hub');
  assert.equal(M.validate(model([], [], { hub: '  ' })).hubProblem, null);
  const bad = M.validate(model([], [], { hub: 'A [1]' }));
  assert.equal(bad.hub, 'Hub');
  assert.equal(bad.hubProblem, 'brackets');
  assert.equal(M.validate(model([], [], { hub: ' Plan ' })).hub, 'Plan');
});

test('validate: the remainder cannot be the hub or a source', () => {
  assert.equal(M.validate(model([['Wages', '1']], [], { rest: 'Budget' })).restProblem, 'hub');
  assert.equal(M.validate(model([['Wages', '1']], [], { rest: 'Wages' })).restProblem, 'otherside');
  assert.equal(M.validate(model([['Wages', '1']], [], { rest: '' })).rest, 'Left over');
  assert.equal(M.validate(model([['Wages', '1']], [['Food', '1']], { rest: 'Food' })).restProblem, null);
});

// MARK toText

test('toText writes the starter exactly as the in_out_budget recipe has it', () => {
  assert.equal(
    M.toText(M.starterModel()),
    sampleDiagramRecipes.get('in_out_budget').flows
  );
});

test('toText draws the remainder only when there is a surplus', () => {
  const surplus = M.toText(model([['Wages', '100']], [['Rent', '60']])),
    even = M.toText(model([['Wages', '100']], [['Rent', '100']])),
    short = M.toText(model([['Wages', '100']], [['Rent', '140']]));
  assert.match(surplus, /^Budget \[\*\] Savings$/m);
  assert.doesNotMatch(even, /\[\*\]/);
  assert.doesNotMatch(short, /\[\*\]/);
});

test('toText leaves refused rows out and never writes a cycle', () => {
  const text = M.toText(model(
    [['Wages', '100'], ['Budget', '5'], ['A [1] B', '5']],
    [['Rent', '60'], ['Wages', '5']],
    { rest: 'Wages' }
  ));
  assert.equal(text, 'Wages [100] Budget\n\nBudget [60] Rent');
});

test('toText is empty when no row can be drawn', () => {
  assert.equal(M.toText(model([['', '5']], [['', '']])), '');
});

test('toText with only sources draws them into the hub and on to the remainder', () => {
  assert.equal(M.toText(model([['Wages', '100']], [])), 'Wages [100] Budget\n\nBudget [*] Savings');
  // Nothing to carry on: no remainder and no trailing blank line.
  assert.equal(M.toText(model([['Wages', '0']], [])), 'Wages [0] Budget');
});

test('toText normalizes amounts and treats a missing one as zero', () => {
  const text = M.toText(model([['Wages', '1,500.50'], ['Bonus', '']], [['Rent', '.5']]));
  assert.match(text, /^Wages \[1500\.50\] Budget$/m);
  assert.match(text, /^Bonus \[0\] Budget$/m);
  assert.match(text, /^Budget \[0\.5\] Rent$/m);
});

test('toText: palette colours follow row position; theme mode writes none', () => {
  const m = model([['a', '1'], ['b', '1']], [['c', '1']], { colors: 'rows' }),
    text = M.toText(m);
  assert.match(text, /^:a #2f6f4f$/m);
  assert.match(text, /^:b #6fa287$/m);
  assert.match(text, /^:c #b5532f$/m);
  assert.match(text, /^:Budget #1d2b23$/m);
  assert.match(text, /^:Savings #2f6f4f$/m);
  assert.doesNotMatch(M.toText({ ...m, colors: 'theme' }), /^:/m);
});

test('toText keeps a carried colour and a carried flow suffix', () => {
  const m = model([['a', '5']], [['c', '1']]);
  m.outs[0].color = '#606';
  m.outs[0].flow = '#123.5';
  m.hubColor = '#057';
  const text = M.toText(m);
  assert.match(text, /^Budget \[1\] c #123\.5$/m);
  assert.match(text, /^:c #606$/m);
  assert.match(text, /^:Budget #057$/m);
});

test('toText palette wraps around when there are more rows than colours', () => {
  const ins = Array.from({ length: 5 }, (_, i) => [`s${i}`, '1']),
    text = M.toText(model(ins, [], { colors: 'rows' }));
  assert.match(text, /^:s4 #2f6f4f$/m);
});

// MARK fromRender

test('fromRender: the starter comes back as the same model, exactly', () => {
  const starter = M.starterModel(),
    result = M.fromRender(detailFromText(M.toText(starter)));
  assert.equal(result.ok, true);
  assert.equal(result.exact, true);
  assert.deepEqual(result.model, starter);
  // ...and writes the same text again:
  assert.equal(M.toText(result.model), M.toText(starter));
});

test('fromRender: the stock page’s default budget is hub-shaped', () => {
  const stock = sampleDiagramRecipes.get('default_budget').flows,
    result = M.fromRender(detailFromText(stock));
  assert.equal(result.ok, true);
  assert.equal(result.exact, true);
  const { model: m } = result;
  assert.equal(m.hub, 'Budget');
  assert.equal(m.rest, 'Savings');
  assert.equal(m.colors, 'theme');
  assert.equal(m.hubColor, '#057');
  assert.deepEqual(m.ins.map((r) => [r.name, r.amount]), [['Wages', '1500'], ['Other', '250']]);
  assert.deepEqual(
    m.outs.map((r) => [r.name, r.amount, r.flow]),
    [['Taxes', '450', undefined], ['Housing', '420', undefined], ['Food', '400', undefined],
      ['Transportation', '255', undefined], ['Other Necessities', '160', '#606']]
      .map(([n, a, f]) => [n, a, f || null])
  );
  // Writing it back keeps the hub colour and the one coloured flow:
  const text = M.toText(m);
  assert.match(text, /^Budget \[160\] Other Necessities #606$/m);
  assert.match(text, /^:Budget #057$/m);
  assert.match(text, /^Budget \[\*\] Savings$/m);
});

test('fromRender: the multi-stage samples are not hub-shaped', () => {
  const expected = {
    job_search: 'not-one-hub',
    financial_results: 'node-feature', // uses << paint flags
    journey: 'not-one-hub',
    election: 'node-feature',
    simple_start: 'no-hub',
  };
  Object.entries(expected).forEach(([name, reason]) => {
    const result = M.fromRender(detailFromText(sampleDiagramRecipes.get(name).flows));
    assert.equal(result.ok, false, name);
    assert.equal(result.reason, reason, name);
  });
});

test('fromRender: a two-stage chain is not one hub', () => {
  const d = renderDetail([['a', '1', 'b'], ['b', '1', 'c'], ['c', '1', 'd']]);
  assert.deepEqual(M.fromRender(d), { ok: false, reason: 'not-one-hub' });
});

test('fromRender: a flow that bypasses the hub is not hub-shaped', () => {
  const d = renderDetail([['a', '1', 'h'], ['h', '1', 'c'], ['a', '1', 'c']]);
  assert.deepEqual(M.fromRender(d), { ok: false, reason: 'not-one-hub' });
});

test('fromRender refuses when the engine reported problems or drew nothing', () => {
  const d = renderDetail([['a', '1', 'h'], ['h', '1', 'c']]);
  assert.deepEqual(M.fromRender({ ...d, issues: 1 }), { ok: false, reason: 'issues' });
  assert.deepEqual(M.fromRender(renderDetail([])), { ok: false, reason: 'no-flows' });
  assert.deepEqual(M.fromRender(null), { ok: false, reason: 'no-flows' });
});

test('fromRender refuses calculated amounts it cannot express', () => {
  assert.equal(M.fromRender(renderDetail([['a', '*', 'h'], ['h', '1', 'c']])).reason, 'calculated-in');
  assert.equal(M.fromRender(renderDetail([['a', '?', 'h'], ['h', '1', 'c']])).reason, 'calculated-in');
  assert.equal(M.fromRender(renderDetail([['a', '1', 'h'], ['h', '?', 'c']])).reason, 'fill-missing');
  assert.equal(
    M.fromRender(renderDetail([['a', '5', 'h'], ['h', '*', 'c'], ['h', '*', 'd']])).reason,
    'two-remainders'
  );
});

test('fromRender refuses node details rows cannot carry', () => {
  const flows = [['a', '1', 'h'], ['h', '1', 'c']];
  [{ opacity: true }, { label: true }, { paint: true }, { hidden: true },
    { color: 'hsl(10 20% 30%)' }, { color: 'tomato' }].forEach((spec) => {
    assert.equal(M.fromRender(renderDetail(flows, { c: spec })).reason, 'node-feature');
  });
});

test('fromRender undoes "Reverse the graph"', () => {
  // The engine has swapped every flow's ends and turned * into ?:
  const d = renderDetail(
    [['h', '5', 'a'], ['c', '3', 'h'], ['s', '?', 'h']],
    {},
    { reversed: true }
  );
  // The engine still lists nodes in the order the text introduced them:
  d.nodes = ['a', 'h', 'c', 's'].map((name) => d.nodes.find((n) => n.name === name));
  const { ok, exact, model: m } = M.fromRender(d);
  assert.equal(ok, true);
  assert.equal(exact, true);
  assert.equal(m.hub, 'h');
  assert.deepEqual(m.ins.map((r) => r.name), ['a']);
  assert.deepEqual(m.outs.map((r) => r.name), ['c']);
  assert.equal(m.rest, 's');
});

test('fromRender: a leftover with no "[*]" flow converts, but not exactly', () => {
  const result = M.fromRender(renderDetail([['a', '10', 'h'], ['h', '4', 'c']]));
  assert.equal(result.ok, true);
  assert.equal(result.exact, false);
  assert.equal(result.model.rest, 'Left over');
});

test('fromRender: a "[*]" flow with nothing left over is not exact', () => {
  const result = M.fromRender(renderDetail([['a', '4', 'h'], ['h', '4', 'c'], ['h', '*', 's']]));
  assert.equal(result.ok, true);
  assert.equal(result.exact, false);
});

test('fromRender: a deficit with no remainder is exact', () => {
  const result = M.fromRender(renderDetail([['a', '4', 'h'], ['h', '9', 'c']]));
  assert.equal(result.ok, true);
  assert.equal(result.exact, true);
  assert.equal(M.balance(result.model).state, 'deficit');
});

test('fromRender keeps colours that are not the palette’s', () => {
  const d = renderDetail(
    [['a', '5', 'h'], ['b', '5', 'h'], ['h', '3', 'c']],
    { a: { color: '#2F6F4F' }, b: { color: '#ff0000' }, c: { color: '#b5532f' }, h: { color: '#1d2b23' } }
  );
  const { model: m } = M.fromRender(d);
  assert.equal(m.colors, 'rows');
  assert.deepEqual(m.ins.map((r) => r.color), [null, '#ff0000']);
  assert.deepEqual(m.outs.map((r) => r.color), [null]);
  assert.equal(m.hubColor, null);
});

test('fromRender: rows without their own colours mean the engine’s theme is in use', () => {
  const d = renderDetail(
    [['a', '5', 'h'], ['b', '5', 'h'], ['h', '3', 'c']],
    { a: { color: '#2f6f4f' } }
  );
  const { model: m } = M.fromRender(d);
  assert.equal(m.colors, 'theme');
  assert.deepEqual(m.ins.map((r) => r.color), ['#2f6f4f', null]);
});

test('fromRender: an uncoloured hub keeps the engine’s theme, even when every row is coloured', () => {
  const d = renderDetail(
    [['a', '10', 'h'], ['h', '10', 'c']],
    { a: { color: '#f00' }, c: { color: '#00f' } }
  );
  const { ok, exact, model: m } = M.fromRender(d);
  assert.equal(ok, true);
  assert.equal(exact, true);
  assert.equal(m.colors, 'theme');
  // Writing it back must not give the hub a colour it never had:
  assert.equal(M.toText(m), 'a [10] h\n\nh [10] c\n\n:a #f00\n:c #00f');
});

test('fromRender: an uncoloured remainder keeps the engine’s theme too', () => {
  const d = renderDetail(
    [['a', '10', 'h'], ['h', '4', 'c'], ['h', '*', 's']],
    { a: { color: '#f00' }, c: { color: '#00f' }, h: { color: '#333' } }
  );
  const { model: m } = M.fromRender(d);
  assert.equal(m.colors, 'theme');
  assert.doesNotMatch(M.toText(m), /^:s /m);
});

test('fromRender: a leading + on an amount is the same number', () => {
  const { ok, exact, model: m } = M.fromRender(renderDetail([['a', '+100', 'h'], ['h', '+100.50', 'c']]));
  assert.equal(ok, true);
  assert.equal(exact, true);
  assert.deepEqual([m.ins[0].amount, m.outs[0].amount], ['100', '100.50']);
  assert.equal(M.balance(m).totalIn, 100);
});

test('fromRender refuses an amount it would read as a different number', () => {
  // The engine reads these with parseFloat-like leniency; rows would not.
  ['1e3', '+-5', '0x10'].forEach((amount) => {
    const result = M.fromRender(renderDetail([['a', amount, 'h'], ['h', '1', 'c']]));
    assert.deepEqual(result, { ok: false, reason: 'amount' }, amount);
  });
});

test('fromRender: nodes introduced in another order convert, but not exactly', () => {
  // As if the text had declared ':c' before any flow, so that 'c' is first:
  const d = renderDetail([['a', '5', 'h'], ['h', '5', 'c']]);
  d.nodes = [d.nodes[2], d.nodes[0], d.nodes[1]];
  const result = M.fromRender(d);
  assert.equal(result.ok, true);
  assert.equal(result.exact, false);
});

test('fromRender: destinations listed before sources are not exact', () => {
  const result = M.fromRender(renderDetail([['h', '5', 'c'], ['a', '5', 'h']]));
  assert.equal(result.ok, true);
  assert.equal(result.exact, false);
});

test('fromRender: a remainder in the middle of the destinations is not exact', () => {
  const result = M.fromRender(renderDetail([['a', '9', 'h'], ['h', '*', 's'], ['h', '4', 'c']]));
  assert.equal(result.ok, true);
  assert.equal(result.exact, false);
});

test('fromRender refuses a diagram with a name a row could not hold', () => {
  // All of these are valid to the engine; as rows, the flow would vanish.
  [
    [['a', '10', 'h'], ['h', '10', ':c']],
    [['a', '10', 'h'], ['h', '10', "'c"]],
    [["'a", '10', 'h'], ['h', '10', 'c']],
    [['a', '10', '//h'], ['//h', '10', 'c']],
    [['a', '10', 'h'], ['h', '4', 'c'], ['h', '*', ':rest']],
  ].forEach((flows) => {
    assert.deepEqual(M.fromRender(renderDetail(flows)), { ok: false, reason: 'name' });
  });
});

test('fromRender: two rows with one name stay two rows', () => {
  const d = renderDetail([['a', '5', 'h'], ['a', '2', 'h'], ['h', '7', 'c']]);
  const { model: m } = M.fromRender(d);
  assert.deepEqual(m.ins.map((r) => [r.name, r.amount]), [['a', '5'], ['a', '2']]);
});

test('round trip: toText then fromRender keeps what was typed', () => {
  const m = model(
    [['Salary', '3200.50'], ['Side job', '410']],
    [['Rent', '1400'], ['Item #2', '99.5'], ['Fun & games', '250']],
    { hub: 'October', rest: 'Rainy day', colors: 'rows' }
  );
  const back = M.fromRender(detailFromText(M.toText(m)));
  assert.equal(back.ok, true);
  assert.equal(back.exact, true);
  assert.deepEqual(
    back.model.ins.concat(back.model.outs).map((r) => [r.name, r.amount]),
    m.ins.concat(m.outs).map((r) => [r.name, r.amount])
  );
  assert.equal(back.model.hub, 'October');
  assert.equal(back.model.rest, 'Rainy day');
  assert.equal(back.model.colors, 'rows');
  assert.equal(M.toText(back.model), M.toText(m));
});

// MARK formatNumber

test('formatNumber follows the diagram’s number format', () => {
  assert.equal(M.formatNumber(1750), '1,750');
  assert.equal(M.formatNumber(1234567.5, { places: 2 }), '1,234,567.50');
  assert.equal(M.formatNumber(1234.5, { places: 2, group: '.', decimal: ',' }), '1.234,50');
  assert.equal(M.formatNumber(1234.5, { places: 2, group: ' ', decimal: ',' }), '1 234,50');
  assert.equal(M.formatNumber(1234.5, { places: 2, group: '' }), '1234.50');
  assert.equal(M.formatNumber(65, { prefix: '$', suffix: 'k' }), '$65k');
  assert.equal(M.formatNumber(1234.5, { places: 2, trim: true }), '1,234.5');
  assert.equal(M.formatNumber(12, { places: 2, trim: true }), '12');
  assert.equal(M.formatNumber(0), '0');
});

// MARK palette

test('rowColor: own colour first, then the palette, else the engine decides', () => {
  const m = model([['a', '1'], ['b', '1']], [['c', '1']], { colors: 'rows' });
  m.ins[1].color = '#123456';
  assert.equal(M.rowColor(m, 'ins', 0), M.IN_COLORS[0]);
  assert.equal(M.rowColor(m, 'ins', 1), '#123456');
  assert.equal(M.rowColor(m, 'outs', 0), M.OUT_COLORS[0]);
  assert.equal(M.rowColor({ ...m, colors: 'theme' }, 'ins', 0), null);
  assert.equal(M.rowColor({ ...m, colors: 'theme' }, 'ins', 1), '#123456');
});
