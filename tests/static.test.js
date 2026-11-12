// Checks on the shipped files themselves: that the page loads nothing from
// another site, that the engine finds every element it looks up, and that
// the touch rules are in the stylesheet. These read the files as text, so
// they run anywhere Node does (including the Nix build that deploys the site).
'use strict';

const test = require('node:test'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto'),
  fs = require('node:fs'),
  path = require('node:path'),
  { buildDir, loadConstants } = require('./fixtures.js');

const read = (name) => fs.readFileSync(path.join(buildDir, name), 'utf8'),
  html = read('index.html'),
  css = read('app.css'),
  { skmSettings } = loadConstants();

/** Every value of an attribute on a given tag, e.g. attrs('script', 'src') */
function attrs(tag, attr) {
  const found = [],
    reTag = new RegExp(`<${tag}\\b[^>]*>`, 'gi'),
    reAttr = new RegExp(`\\b${attr}\\s*=\\s*"([^"]*)"`, 'i');
  (html.match(reTag) || []).forEach((t) => {
    const m = t.match(reAttr);
    if (m) { found.push(m[1]); }
  });
  return found;
}

const isRemote = (url) => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url);

// MARK Nothing is loaded from another site

test('index.html loads scripts, styles, images and icons only from its own files', () => {
  const loaded = [
    ...attrs('script', 'src'),
    ...attrs('link', 'href'),
    ...attrs('img', 'src'),
    ...attrs('source', 'src'),
    ...attrs('iframe', 'src'),
  ];
  assert.ok(loaded.length >= 9, 'expected the page to load its scripts and stylesheet');
  loaded.forEach((url) => {
    assert.ok(!isRemote(url), `${url} is loaded from another site`);
    assert.ok(fs.existsSync(path.join(buildDir, url)), `${url} does not exist`);
  });
});

test('every script is a file: no inline scripts and no inline handlers', () => {
  (html.match(/<script\b[^>]*>/gi) || []).forEach((tag) => {
    assert.match(tag, /\bsrc=/, `inline script: ${tag}`);
  });
  const handler = html.match(/<[^>]+\son[a-z]+\s*=/i);
  assert.equal(handler, null, `inline event handler: ${handler && handler[0]}`);
});

test('the stylesheet refers only to its own files', () => {
  assert.doesNotMatch(css, /@import/);
  const urls = Array.from(css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)).map((m) => m[1]);
  assert.ok(urls.length >= 5, 'expected the four font files and the transparency pattern');
  urls.forEach((url) => {
    assert.ok(!isRemote(url), `${url} is loaded from another site`);
    assert.ok(fs.existsSync(path.join(buildDir, url)), `${url} does not exist`);
  });
});

test('the scripts do not fetch or import anything at run time', () => {
  ['app.js', 'inout-model.js', 'sankeymatic.js', 'sankey.js', 'constants.js'].forEach((name) => {
    const code = read(name);
    assert.doesNotMatch(code, /\bfetch\s*\(|XMLHttpRequest|\bimport\s*\(|importScripts|new\s+WebSocket/, name);
    assert.doesNotMatch(code, /cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com/, name);
  });
});

test('a Content-Security-Policy holds the page to its own origin', () => {
  const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(meta, 'no Content-Security-Policy meta tag');
  const policy = Object.fromEntries(
    meta[1].split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...v]) => [name, v.join(' ')])
  );
  assert.equal(policy['default-src'], "'self'");
  assert.equal(policy['script-src'], "'self'");
  assert.equal(policy['font-src'], "'self'");
  assert.equal(policy['connect-src'], "'self'");
  assert.equal(policy['object-src'], "'none'");
  assert.equal(policy['base-uri'], "'none'");
  assert.doesNotMatch(meta[1], /unsafe-eval|https?:|\*/);
});

test('vendored libraries and fonts are the files their README records', () => {
  [['vendor', /`([\w.-]+\.js)`[^\n]*`([a-f0-9]{64})`/g],
    ['fonts', /`([\w.-]+\.woff2)`[^\n]*`([a-f0-9]{64})`/g]].forEach(([dir, re]) => {
    const recorded = Array.from(read(`${dir}/README.md`).matchAll(re)),
      shipped = fs.readdirSync(path.join(buildDir, dir))
        .filter((f) => /\.(?:js|woff2)$/.test(f)).sort();
    assert.deepEqual(recorded.map((m) => m[1]).sort(), shipped, `${dir}/README.md lists every file`);
    recorded.forEach(([, file, sha]) => {
      const actual = crypto.createHash('sha256')
        .update(fs.readFileSync(path.join(buildDir, dir, file))).digest('hex');
      assert.equal(actual, sha, `${dir}/${file} differs from its recorded hash`);
    });
    assert.ok(fs.readdirSync(path.join(buildDir, dir)).some((f) => f.startsWith('LICENSE')),
      `${dir}/ has its licence`);
  });
});

// MARK The engine's contract with the page

test('every setting the engine reads has a control in the form', () => {
  const form = html.slice(html.indexOf('<form id="skm_form"'), html.indexOf('</form>'));
  assert.ok(form.length > 1000, 'skm_form not found');
  skmSettings.forEach(([type], name) => {
    const byId = new RegExp(`\\bid="${name}"`).test(form),
      byName = new RegExp(`\\bname="${name}"`).test(form);
    assert.ok(type === 'radio' ? byName : byId, `no control for the setting ${name}`);
  });
});

test('every radio setting offers exactly the values the engine allows', () => {
  skmSettings.forEach(([type, , allowed], name) => {
    if (type !== 'radio') { return; }
    const offered = Array.from(html.matchAll(/<input\b[^>]*>/g))
      .map((m) => m[0])
      .filter((tag) => new RegExp(`\\bname="${name}"`).test(tag))
      .map((tag) => tag.match(/\bvalue="([^"]*)"/)[1]);
    assert.deepEqual(offered.sort(), [...allowed].sort(), name);
  });
});

test('every element the engine looks up by id exists', () => {
  const required = [
    'skm_form', 'flows_in', 'chart', 'sankey_svg', 'svg_scratch', 'png_preview',
    'issue_messages', 'info_messages', 'totals_area', 'imbalance_messages',
    'imbalances_area', 'console_area', 'console_lines', 'scale_figures',
    'save_as_png_1x', 'save_as_png_2x', 'save_as_png_4x', 'save_as_png_6x',
    'reset_all_moved_nodes', 'load_diagram_from_file', 'replace_graph_warning',
    'replace_graph_yes', 'demo_graph_chosen', 'input_options',
    'layout_attachto_leading', 'layout_attachto_trailing', 'layout_attachto_nearest',
    ...['a', 'b', 'c', 'd'].flatMap((t) => [
      `theme_${t}_radio`, `theme_${t}_label`, `theme_${t}_guide`, `themeoffset_${t}`,
    ]),
  ];
  required.forEach((id) => {
    assert.match(html, new RegExp(`\\bid="${id}"`), `missing #${id}`);
  });
  // Each slider has the readout the engine writes its value into:
  Array.from(html.matchAll(/<input\b[^>]*type="range"[^>]*>/g)).forEach(([tag]) => {
    const id = tag.match(/\bid="([^"]+)"/)[1];
    assert.match(html, new RegExp(`\\bid="${id}_val"`), `missing readout for ${id}`);
  });
});

test('ids are unique', () => {
  const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g)).map((m) => m[1]),
    twice = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(twice, []);
});

test('the engine publishes its renders and its share link', () => {
  const engine = read('sankeymatic.js');
  assert.match(engine, /new CustomEvent\('skm:render'/);
  assert.match(engine, /glob\.skmShareLink = /);
  // ...at both of process_sankey's exits:
  assert.equal((engine.match(/\bpublishRender\(\{/g) || []).length, 2);
});

test('the mock’s stand-in renderer is not shipped', () => {
  fs.readdirSync(buildDir).filter((f) => f.endsWith('.js')).forEach((name) => {
    assert.doesNotMatch(read(name), /Sankey\.render\s*=|Sankey\.fmt\s*=|Sankey\.render\(/, name);
  });
  assert.match(read('sankey.js'), /d3\.sankey = /, 'sankey.js is the engine’s layout code');
});

test('the sample buttons name recipes that exist', () => {
  const { sampleDiagramRecipes } = loadConstants(),
    samples = Array.from(html.matchAll(/data-sample="([^"]+)"/g)).map((m) => m[1]);
  assert.equal(samples.length, 6);
  samples.forEach((s) => assert.ok(sampleDiagramRecipes.has(s), s));
});

// MARK Touch

/** Split a stylesheet into [selector, declarations] pairs, media blocks flattened. */
function rules(sheet) {
  const out = [],
    flat = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0,
    start = 0,
    selector = '',
    media = null;
  for (let i = 0; i < flat.length; i += 1) {
    if (flat[i] === '{') {
      const head = flat.slice(start, i).trim();
      if (head.startsWith('@media')) {
        media = head;
      } else if (!head.startsWith('@')) {
        selector = head;
      } else {
        selector = null; // @font-face, @keyframes
      }
      depth += 1;
      start = i + 1;
    } else if (flat[i] === '}') {
      depth -= 1;
      if (selector) { out.push({ media, selector, body: flat.slice(start, i) }); }
      selector = '';
      if (depth === 0) { media = null; }
      start = i + 1;
    }
  }
  return out;
}

const reControl = /(?:^|[\s>+~,(])(?:input|select|textarea|button)\b|\.(?:rm|x|nudge|plus|quiet|linkish)\b/;

function fontPx(body) {
  const m = body.match(/(?:^|[;\s])font(?:-size)?\s*:\s*[^;]*?(\d+(?:\.\d+)?)px/);
  return m ? Number(m[1]) : null;
}

test('controls are at least 16px for a coarse pointer, and that rule comes last', () => {
  const all = rules(css),
    coarse = all.filter((r) => r.media && r.media.includes('(pointer: coarse)')),
    sixteen = coarse.find((r) => /font-size:\s*16px/.test(r.body));
  assert.ok(sixteen, 'no 16px rule under @media (pointer: coarse)');
  const covered = sixteen.selector.split(',').map((s) => s.trim());
  ['input', 'select', 'textarea', 'button'].forEach((tag) => {
    assert.ok(covered.includes(tag), `${tag} is not covered by the 16px rule`);
  });
  // Nothing after the coarse block can undo it:
  assert.equal(all[all.length - 1].media, coarse[0].media, 'the coarse-pointer block must be last');

  // A more specific rule that makes a control's text smaller must be named
  // in the 16px rule too, or it would win on a phone:
  all.filter((r) => !(r.media || '').includes('(pointer: coarse)')).forEach((r) => {
    const px = fontPx(r.body);
    if (px === null || px >= 16) { return; }
    r.selector.split(',').map((s) => s.trim()).filter((s) => reControl.test(s)).forEach((s) => {
      assert.ok(covered.includes(s), `"${s}" sets ${px}px on a control but is not in the coarse-pointer rule`);
    });
  });
});

test('the viewport never disables zoom', () => {
  const viewport = html.match(/<meta name="viewport" content="([^"]+)"/);
  assert.ok(viewport);
  assert.match(viewport[1], /width=device-width/);
  assert.doesNotMatch(viewport[1], /user-scalable|maximum-scale|minimum-scale/);
});

test('one column at 980px and below', () => {
  const narrow = rules(css).find((r) => r.media && r.media.includes('max-width: 980px')
    && /^\.board\b/.test(r.selector));
  assert.ok(narrow, 'no .board rule under max-width: 980px');
  assert.match(narrow.body, /grid-template-columns:\s*minmax\(0, 1fr\)/);
});
