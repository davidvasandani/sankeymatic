// Test helpers: build what sankeymatic.js publishes after a render
// (see publishRender), from a short description of a diagram.
'use strict';

const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');

const buildDir = path.join(__dirname, '..', 'build');

/**
 * @param {Array} flowSpecs [source, amount, target, suffix?] where amount is
 *  a string, or '*' / '?' for a calculated flow
 * @param {object} [nodeSpecs] name => { color, opacity, label, paint, hidden }
 * @param {object} [extra] overrides for the detail (issues, reversed)
 * @returns {object} a render detail
 */
function renderDetail(flowSpecs, nodeSpecs = {}, extra = {}) {
  const nodes = new Map();
  function node(name) {
    if (!nodes.has(name)) {
      const spec = nodeSpecs[name] || {};
      nodes.set(name, {
        name,
        // After a render every node has a color; only some were typed:
        color: spec.color || '#888888',
        hideWholeLabel: Boolean(spec.hidden),
        fromInput: {
          color: Boolean(spec.color),
          opacity: Boolean(spec.opacity),
          label: Boolean(spec.label),
          paint: Boolean(spec.paint),
        },
      });
    }
    return nodes.get(name);
  }
  const flows = flowSpecs.map(([source, amount, target, suffix]) => {
    const calculated = amount === '*' || amount === '?';
    return {
      source: node(source),
      target: node(target),
      value: calculated ? 0 : amount,
      operation: calculated ? amount : null,
      inputSuffix: suffix,
    };
  });
  return {
    hasFlows: flows.length > 0,
    issues: 0,
    reversed: false,
    nodes: Array.from(nodes.values()),
    flows,
    ...extra,
  };
}

/**
 * Turn simple SankeyMATIC text (flows, ':Name #color' lines, comments) into
 * a render detail. Only as much of the syntax as the sample diagrams use.
 * @param {string} text
 * @returns {object} a render detail
 */
function detailFromText(text) {
  const flowSpecs = [],
    nodeSpecs = {};
  text.split('\n').map((l) => l.trim()).forEach((line) => {
    if (line === '' || line.startsWith('//')) { return; }
    const nodeLine = line.match(/^:(.+) #([a-f0-9]{3,6})\s*(<<|>>)?\s*(<<|>>)?$/i);
    if (nodeLine) {
      nodeSpecs[nodeLine[1].trim()] = {
        color: `#${nodeLine[2]}`,
        paint: Boolean(nodeLine[3]),
      };
      return;
    }
    const flow = line.match(/^(.+)\[([\d.]+|\*|\?)\](.+)$/);
    if (!flow) { throw new Error(`fixture cannot read: ${line}`); }
    let target = flow[3].trim(),
      suffix;
    const colored = target.match(/^(.+)\s+(#[a-f0-9]{3,6}(?:\.\d+)?)$/i);
    if (colored) { [, target, suffix] = colored; }
    flowSpecs.push([flow[1].trim(), flow[2], target, suffix]);
  });
  return renderDetail(flowSpecs, nodeSpecs);
}

/** @returns {object} the values constants.js defines, by name */
function loadConstants() {
  const code = fs.readFileSync(path.join(buildDir, 'constants.js'), 'utf8');
  return vm.runInNewContext(
    `${code}\n({ skmSettings, sampleDiagramRecipes });`
  );
}

module.exports = {
  buildDir, renderDetail, detailFromText, loadConstants,
};
