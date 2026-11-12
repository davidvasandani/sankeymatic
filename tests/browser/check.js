// Browser check for the In & Out front end.
//
// Not part of `npm test` (it needs a browser). Run it by hand before shipping
// a front-end change:
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
//   CHROMIUM=/path/to/chromium \
//   node tests/browser/check.js [site-root]
//
// Optional:
//   SHOTS=dir   write screenshots there
//   STOCK=dir   a copy of upstream's build/ (git show a6d8053:build/...), to
//               prove links and files made by the stock page still open
//
// Exits non-zero if any check fails.
'use strict';

const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  { serve } = require('./serve.js');

const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core'),
  root = process.argv[2] || path.join(__dirname, '..', '..', 'build'),
  shots = process.env.SHOTS,
  stockRoot = process.env.STOCK,
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-check-'));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

async function shot(page, name, opts = {}) {
  if (!shots) { return; }
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true, ...opts });
}

// What a page must never do, collected for every page we open on the site:
function watch(page, origin, problems) {
  page.on('console', (m) => {
    if (m.type() === 'error') { problems.push(`console error: ${m.text()}`); }
  });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));
  page.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) {
      problems.push(`third-party request: ${url}`);
    }
  });
}

async function open(context, url, origin, problems) {
  const page = await context.newPage();
  watch(page, origin, problems);
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  await page.goto(url);
  await page.waitForFunction(() => window.skmLastRender && document.fonts.status === 'loaded');
  return page;
}

const view = (page) => page.evaluate(() => document.getElementById('board').dataset.view);
const text = (page) => page.evaluate(() => document.getElementById('flows_in').value);
// The diagram, without ids/classes that never reach an exported file:
const svg = (page) => page.evaluate(() => document.getElementById('sankey_svg').innerHTML);
const visible = (page, id) => page.evaluate(
  (i) => { const e = document.getElementById(i); return !e.hidden && e.offsetParent !== null; },
  id
);
const rows = (page, side) => page.evaluate(
  (s) => Array.from(document.getElementById(s).children).map((e) => [
    e.querySelector('.nm').value, e.querySelector('.amt').value,
  ]),
  side
);

async function setRow(page, side, index, field, value) {
  await page.locator(`#${side} .entry`).nth(index).locator(field).fill(value);
}

async function download(page, trigger) {
  const [file] = await Promise.all([page.waitForEvent('download'), trigger()]),
    saved = path.join(tmp, file.suggestedFilename());
  await file.saveAs(saved);
  return saved;
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  return {
    isPng: b.subarray(1, 4).toString() === 'PNG',
    width: b.readUInt32BE(16),
    height: b.readUInt32BE(20),
    bytes: b.length,
  };
}

// Read one pixel of a PNG file by decoding it in the page:
function pixel(page, file, x, y) {
  const b64 = fs.readFileSync(file).toString('base64');
  return page.evaluate(async ([data, px, py]) => {
    // (Not fetch(): the page's policy only lets it connect to itself.)
    const bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0)),
      bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' })),
      c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    return Array.from(ctx.getImageData(px, py, 1, 1).data);
  }, [b64, Math.round(x), Math.round(y)]);
}

async function desktop(browser, site, problems) {
  const origin = site.url.replace(/\/$/, ''),
    context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      acceptDownloads: true,
    });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const page = await open(context, site.url, origin, problems);

  // --- Starter ---
  check('opens on the In & Out view', await view(page) === 'inout');
  check('budget example: sources', JSON.stringify(await rows(page, 'ins'))
    === JSON.stringify([['Wages', '1500'], ['Other', '250']]));
  check('budget example: destinations', (await rows(page, 'outs')).length === 5);
  check('hub is Budget', await page.inputValue('#hub') === 'Budget');
  check('meter shows 1,750 in and 1,685 out',
    await page.textContent('#t-in') === '1,750' && await page.textContent('#t-out') === '1,685');
  check('surplus sentence names 65 and Savings',
    await visible(page, 'verdict_surplus') && await page.textContent('#left_over') === '65'
      && await page.inputValue('#rest') === 'Savings');
  check('the diagram is drawn by the engine',
    await page.locator('#sankey_svg #sankey_nodes rect').count() === 9
      && await page.locator('#sankey_svg #sankey_flows path').count() === 8);
  check('Figtree and Young Serif are loaded from this origin', await page.evaluate(
    () => document.fonts.check('15px Figtree') && document.fonts.check('20px "Young Serif"')
      && getComputedStyle(document.body).fontFamily.includes('Figtree')
      && getComputedStyle(document.querySelector('.col h2')).fontFamily.includes('Young Serif')
  ));
  check('rows carry the colour of their ribbon', await page.evaluate(() => {
    const amt = document.querySelector('#outs .entry .amt');
    return getComputedStyle(amt).boxShadow.includes('rgb(181, 83, 47)');
  }));
  check('source ribbons take the source colour, destination ribbons the destination colour',
    await page.evaluate(() => {
      const d = window.skmLastRender;
      return d.flows.every((f) => f.color === (f.target.name === 'Budget' ? f.source.color : f.target.color));
    }));
  await page.waitForTimeout(700);
  await shot(page, '01-desktop-starter');

  // --- Editing redraws ---
  const before = await svg(page);
  await setRow(page, 'ins', 0, '.amt', '2000');
  check('editing an amount redraws the diagram', await svg(page) !== before);
  check('meter follows the edit', await page.textContent('#t-in') === '2,250'
    && await page.textContent('#left_over') === '565');
  await setRow(page, 'outs', 0, '.nm', 'Income tax');
  check('editing a name redraws the diagram', (await svg(page)).includes('Income tax'));
  await setRow(page, 'outs', 0, '.nm', 'Taxes');

  // --- The three balance states ---
  await setRow(page, 'ins', 0, '.amt', '1435');
  check('in = out: balanced sentence, no remainder drawn',
    await visible(page, 'verdict_balanced') && !(await visible(page, 'verdict_surplus'))
      && (await page.textContent('#verdict_balanced')).trim() === 'In and out balance. Nothing is left over.'
      && !(await text(page)).includes('[*]') && !(await svg(page)).includes('Savings'));
  await setRow(page, 'ins', 0, '.amt', '1000');
  check('in < out: says by how much and what to do',
    await visible(page, 'verdict_deficit') && await page.textContent('#short_by') === '435'
      && (await page.textContent('#verdict_deficit')).includes('Trim a destination or add a source')
      && !(await text(page)).includes('[*]'));
  check('in < out: the bar is full and in the warning colour', await page.evaluate(() => {
    const f = document.getElementById('fill');
    return f.classList.contains('over') && f.style.width === '100%';
  }));
  await page.waitForTimeout(500);
  await shot(page, '02-desktop-deficit');
  await setRow(page, 'ins', 0, '.amt', '1500');
  check('in > out again: remainder is back', await visible(page, 'verdict_surplus')
    && (await text(page)).includes('Budget [*] Savings'));
  await setRow(page, 'ins', 0, '.amt', '0.1');
  await setRow(page, 'ins', 1, '.amt', '0.2');
  for (let i = 0; i < 5; i += 1) { await setRow(page, 'outs', i, '.amt', i === 0 ? '0.3' : '0'); }
  check('0.1 + 0.2 balances against 0.3', await visible(page, 'verdict_balanced'));
  await setRow(page, 'ins', 0, '.amt', '1500');
  await setRow(page, 'ins', 1, '.amt', '250');
  for (const [i, v] of ['450', '420', '400', '255', '160'].entries()) {
    await setRow(page, 'outs', i, '.amt', v);
  }

  // --- Rows: add, refuse, remove ---
  await page.click('[data-add="ins"]');
  check('adding a row focuses its name', await page.evaluate(
    () => document.activeElement === document.querySelector('#ins .entry:last-child .nm')
  ));
  await setRow(page, 'ins', 2, '.nm', 'Bonus');
  await setRow(page, 'ins', 2, '.amt', '500');
  check('a new source is drawn', (await svg(page)).includes('Bonus')
    && await page.textContent('#t-in') === '2,250');
  await setRow(page, 'ins', 2, '.nm', 'Budget');
  check('a row named after the hub is refused with a reason, not drawn',
    (await page.textContent('#ins .entry:last-child .row-note')).includes('name of the hub')
      && !(await text(page)).includes('Budget [500] Budget')
      && await page.textContent('#t-in') === '1,750');
  await setRow(page, 'ins', 2, '.nm', 'A [1] B');
  check('a name with brackets is refused with a reason',
    (await page.textContent('#ins .entry:last-child .row-note')).includes('Square brackets'));
  check('the engine reports no input problems for refused rows',
    await page.evaluate(() => window.skmLastRender.issues === 0
      && document.getElementById('issue_messages').childElementCount === 0));
  await page.locator('#ins .entry').nth(2).locator('.rm').click();
  check('removing a row removes it', (await rows(page, 'ins')).length === 2);

  // --- Hub and remainder names ---
  await page.fill('#hub', 'October');
  check('renaming the hub redraws', (await text(page)).includes('Wages [1500] October')
    && (await svg(page)).includes('October'));
  await page.fill('#rest', 'Rainy day');
  check('renaming the remainder redraws', (await text(page)).includes('October [*] Rainy day')
    && (await svg(page)).includes('Rainy day'));
  await page.fill('#rest', 'October');
  check('a remainder named after the hub is refused with a reason',
    await visible(page, 'rest_note') && !(await text(page)).includes('[*]'));
  await page.fill('#rest', 'Rainy day');

  // --- Share link ---
  const link = await page.evaluate(() => window.skmShareLink());
  await page.click('#btn_link');
  await page.waitForFunction(() => document.getElementById('toast').textContent !== '');
  check('Copy link puts the link on the clipboard',
    await page.evaluate(() => navigator.clipboard.readText()) === link);
  const linked = await open(context, link, origin, problems);
  check('the share link reopens the same diagram', await svg(linked) === await svg(page));
  check('the share link reopens as rows', await view(linked) === 'inout'
    && await linked.inputValue('#hub') === 'October'
    && await linked.inputValue('#rest') === 'Rainy day'
    && JSON.stringify(await rows(linked, 'outs')) === JSON.stringify(await rows(page, 'outs')));
  await linked.close();

  // --- Downloads ---
  await page.click('#btn_download');
  check('Download opens a menu', await visible(page, 'download_menu'));
  await page.keyboard.press('Escape');
  check('Escape closes the menu and returns focus', !(await visible(page, 'download_menu'))
    && await page.evaluate(() => document.activeElement.id === 'btn_download'));

  await page.click('#btn_download');
  const png = pngSize(await download(page, () => page.click('#save_as_png_2x')));
  check('PNG download is a PNG at twice the diagram size',
    png.isPng && png.width === 1200 && png.height === 920, `${png.width}x${png.height}`);
  // The hub's bar and the background must be where the screen shows them:
  const pngFile = fs.readdirSync(tmp).find((f) => f.endsWith('.png')),
    spot = await page.evaluate(() => {
      const hub = window.skmLastRender.nodes.find((n) => n.name === 'October'),
        r = document.getElementById(hub.dom_id).getBoundingClientRect(),
        s = document.getElementById('sankey_svg').getBoundingClientRect();
      // Near the top of the bar, clear of the label drawn over its middle:
      return { x: r.x - s.x + r.width / 2, y: r.y - s.y + 4 };
    }),
    hubPixel = await pixel(page, path.join(tmp, pngFile), spot.x * 2, spot.y * 2),
    cornerPixel = await pixel(page, path.join(tmp, pngFile), 3, 3);
  check('PNG shows the hub where the screen does', hubPixel.join() === '29,43,35,255', hubPixel.join());
  check('PNG has the diagram’s background', cornerPixel.join() === '243,239,228,255', cornerPixel.join());

  await page.click('#btn_download');
  const svgFile = fs.readFileSync(await download(page, () => page.click('#save_as_svg')), 'utf8'),
    onScreen = await page.evaluate(() => ({
      paths: document.querySelectorAll('#sankey_svg path').length,
      rects: document.querySelectorAll('#sankey_svg rect').length,
      texts: Array.from(document.querySelectorAll('#sankey_svg text')).map((t) => t.textContent),
    }));
  check('SVG download has the same shapes as the screen',
    svgFile.startsWith('<svg') && (svgFile.match(/<path/g) || []).length === onScreen.paths
      && (svgFile.match(/<rect/g) || []).length === onScreen.rects
      && ['October', 'Rainy day', 'Wages', 'Taxes'].every((n) => svgFile.includes(n)));

  await page.click('#btn_download');
  const savedPath = await download(page, () => page.click('#save_text')),
    savedText = fs.readFileSync(savedPath, 'utf8');
  check('the text download holds the flows and the settings',
    savedText.includes('Wages [1500] October') && savedText.includes('size w 600')
      && savedText.includes('bg color #f3efe4'));

  // --- Other shapes ---
  const fresh = await open(context, site.url, origin, problems);
  await fresh.click('#btn_shapes');
  check('Other shapes opens a dialog', await fresh.evaluate(() => document.getElementById('shapes_dialog').open));
  await fresh.waitForTimeout(700);
  await shot(fresh, '04-desktop-other-shapes', { fullPage: false });

  // --- Samples and the unsaved-work warning ---
  await fresh.click('[data-sample="job_search"]');
  check('a sample over an untouched diagram loads at once, as text',
    await view(fresh) === 'text' && (await text(fresh)).includes('Applications [4] 1st Interviews'));
  check('multi-stage: Back to In & Out is unavailable and says why',
    await fresh.isDisabled('#btn_back_inout')
      && (await fresh.textContent('#back_note')).includes('another shape'));
  check('multi-stage: totals come from the engine',
    (await fresh.textContent('#totals_area')).includes('8 Flows'));
  await shot(fresh, '05-desktop-text-view');
  const jobLink = await fresh.evaluate(() => window.skmShareLink()),
    job = await open(context, jobLink, origin, problems);
  check('multi-stage: its share link reopens it as text',
    await view(job) === 'text' && await svg(job) === await svg(fresh));
  await job.click('#btn_download');
  const jobPng = pngSize(await download(job, () => job.click('#save_as_png_1x')));
  check('multi-stage: PNG download works', jobPng.isPng && jobPng.width === 700 && jobPng.height === 600);
  await job.close();

  await fresh.fill('#flows_in', 'a [1] b\nb [1] c\nc [1] d');
  await fresh.dispatchEvent('#flows_in', 'change');
  await fresh.click('#btn_shapes');
  await fresh.click('[data-sample="in_out_budget"]');
  check('a sample over edited work asks first',
    await fresh.evaluate(() => document.getElementById('replace_graph_warning').style.display !== 'none')
      && (await text(fresh)).startsWith('a [1] b'));
  await fresh.click('#replace_graph_no');
  check('Cancel keeps the work', (await text(fresh)).startsWith('a [1] b'));
  await fresh.click('[data-sample="in_out_budget"]');
  await fresh.click('#replace_graph_yes');
  check('Yes loads the Budget sample as rows',
    await view(fresh) === 'inout' && await fresh.inputValue('#hub') === 'Budget');

  // --- Text view round trip ---
  await fresh.click('#btn_shapes');
  await fresh.click('#btn_text_mode');
  check('Edit as text shows the same diagram as text',
    await view(fresh) === 'text' && (await text(fresh)).includes('Wages [1500] Budget'));
  check('a hub-shaped diagram can go back to In & Out', !(await fresh.isDisabled('#btn_back_inout')));
  await fresh.fill('#flows_in', 'Pay [100] Pot\nPot [30] Rent\nPot [20] Food');
  await fresh.dispatchEvent('#flows_in', 'change');
  await fresh.click('#btn_back_inout');
  check('going back adds the left-over flow and says how much',
    await view(fresh) === 'inout' && await fresh.textContent('#left_over') === '50'
      && (await text(fresh)).includes('Pot [*] Left over'));

  // --- Open a saved file ---
  await fresh.setInputFiles('#load_diagram_from_file', savedPath);
  await fresh.waitForFunction(() => document.getElementById('hub').value === 'October');
  check('a saved file reopens the same diagram, as rows',
    await view(fresh) === 'inout' && await svg(fresh) === await svg(page));
  await fresh.close();

  // --- Options ---
  await page.click('#btn_options');
  check('Options opens a panel beside the diagram', await page.evaluate(() => {
    const p = document.getElementById('options_panel').getBoundingClientRect(),
      c = document.getElementById('chart_fit').getBoundingClientRect();
    return p.width > 0 && p.left >= c.right;
  }));
  await shot(page, '03-desktop-options', { fullPage: false });
  // Every control changes the picture:
  const acts = async (name, change) => {
    const was = await svg(page);
    await change();
    check(`option acts on the diagram: ${name}`, await svg(page) !== was);
  };
  await acts('row colours → node themes', () => page.check('#io_colors_theme'));
  check('node themes colour the rows', await page.evaluate(
    () => !window.skmLastRender.nodes.some((n) => n.color === '#2f6f4f')
      && document.getElementById('theme_a_radio').checked
  ));
  await acts('theme rotation', () => page.click('.nudge[data-theme="a"][data-move="1"]'));
  await acts('row colours → In & Out palette', () => page.check('#io_colors_rows'));
  await acts('node width', () => page.fill('#node_w', '30').then(() => page.dispatchEvent('#node_w', 'change')));
  await acts('flow opacity', () => page.fill('#flow_opacity', '0.9'));
  await acts('flow colours from target', () => page.check('#flow_inherit_from_target'));
  await page.locator('summary', { hasText: 'Labels' }).first().click();
  await page.locator('summary', { hasText: 'Arrange names' }).click();
  await page.locator('summary', { hasText: 'Number format' }).click();
  await acts('hide labels', () => page.check('#labels_hide'));
  await acts('show labels', () => page.uncheck('#labels_hide'));
  await acts('label font', () => page.check('#serif'));
  await acts('value prefix', () => page.fill('#value_prefix', '$').then(() => page.dispatchEvent('#value_prefix', 'change')));
  check('the meter uses the diagram’s number format', await page.textContent('#t-in') === '$1,750');
  await page.locator('summary', { hasText: 'Size & background' }).click();
  await acts('background colour', () => page.fill('#bg_color', '#ffffff').then(() => page.dispatchEvent('#bg_color', 'change')));
  await acts('width', () => page.fill('#size_w', '900').then(() => page.dispatchEvent('#size_w', 'change')));
  check('a diagram wider than its column is scaled to fit, not clipped', await page.evaluate(() => {
    const fit = document.getElementById('chart_fit').getBoundingClientRect(),
      stage = document.getElementById('stage').getBoundingClientRect(),
      chart = document.getElementById('chart');
    return fit.width <= stage.width + 0.5 && chart.clientWidth === 900
      && chart.style.transform.startsWith('scale(');
  }));
  await page.click('#btn_download');
  const scaled = pngSize(await download(page, () => page.click('#save_as_png_1x')));
  check('PNG of a scaled-down diagram is still full size', scaled.width === 900 && scaled.height === 460,
    `${scaled.width}x${scaled.height}`);
  await page.locator('summary', { hasText: 'Layout' }).click();
  await acts('reverse the graph', () => page.check('#layout_reversegraph'));
  await page.uncheck('#layout_reversegraph');
  await page.keyboard.press('Escape');
  check('Escape closes Options and returns focus', !(await visible(page, 'options_panel'))
    && await page.evaluate(() => document.activeElement.id === 'btn_options'));
  check('every setting the engine reads has a control', await page.evaluate(() => {
    const form = document.forms.skm_form;
    return Array.from(skmSettings.keys()).every((k) => document.getElementById(k) || form.elements[k]);
  }));

  // --- Dragging a node still works under the display scaling ---
  const hubRect = await page.evaluate(() => {
    const hub = window.skmLastRender.nodes.find((n) => n.name === 'October'),
      r = document.getElementById(hub.dom_id).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(hubRect.x, hubRect.y);
  await page.mouse.down();
  await page.mouse.move(hubRect.x, hubRect.y + 25, { steps: 5 });
  await page.mouse.up();
  check('a node can be dragged', await page.evaluate(() => window.rememberedMoves.size === 1)
    && await visible(page, 'reset_moves_area'));
  await page.click('#reset_all_moved_nodes');
  check('moved nodes can be reset', await page.evaluate(() => window.rememberedMoves.size === 0)
    && !(await visible(page, 'reset_moves_area')));

  check('no Content-Security-Policy violations',
    (await page.evaluate(() => window.cspViolations)).length === 0);

  // --- Copy link without clipboard access ---
  const noClip = await open(context, site.url, origin, problems);
  await noClip.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error('denied'));
  });
  await noClip.click('#btn_link');
  check('without clipboard access the link is shown for manual copying',
    await noClip.evaluate(() => document.getElementById('link_dialog').open
      && document.getElementById('link_text').value === window.skmShareLink()));
  await noClip.close();

  // --- Diagrams that are nearly, but not exactly, rows ---
  // Each is written in the text view, shared, and opened from its link.
  const viaLinkOf = async (diagram) => {
    const editor = await open(context, site.url, origin, problems);
    await editor.click('#btn_shapes');
    await editor.click('#btn_text_mode');
    await editor.fill('#flows_in', diagram);
    await editor.dispatchEvent('#flows_in', 'change');
    const made = { link: await editor.evaluate(() => window.skmShareLink()), picture: await svg(editor) };
    await editor.close();
    const opened = await open(context, made.link, origin, problems);
    return { opened, picture: made.picture };
  };

  const plus = await viaLinkOf('a [+100] h\nh [+60.50] c\nh [*] rest');
  check('an amount written with a leading + opens as rows with the same numbers',
    await view(plus.opened) === 'inout' && await plus.opened.textContent('#t-in') === '100.00'
      && await plus.opened.textContent('#t-out') === '60.50'
      && await svg(plus.opened) === plus.picture);
  await plus.opened.close();

  const bareHub = await viaLinkOf('a [10] h\nh [10] c\n:a #f00\n:c #00f');
  const hubColorOf = (p) => p.evaluate(() => window.skmLastRender.nodes.find((n) => n.name === 'h').color);
  const hubWas = await hubColorOf(bareHub.opened);
  await setRow(bareHub.opened, 'ins', 0, '.amt', '12');
  check('a hub left to the theme keeps its colour after a row is edited',
    await view(bareHub.opened) === 'inout' && await hubColorOf(bareHub.opened) === hubWas
      && !(await text(bareHub.opened)).includes(':h '));
  await bareHub.opened.close();

  const declared = await viaLinkOf(':c #00f\na [10] h\nh [10] c');
  check('nodes introduced in another order open as text, picture unchanged',
    await view(declared.opened) === 'text' && await svg(declared.opened) === declared.picture
      && !(await declared.opened.isDisabled('#btn_back_inout'))
      && (await declared.opened.textContent('#back_note')).includes('rewrite the text'));
  await declared.opened.close();

  // --- A link with nothing usable in it ---
  const broken = await open(context, `${site.url}?i=not-a-diagram`, origin, problems);
  check('an undecodable link says so and offers the text view',
    await view(broken) === 'text'
      && (await broken.textContent('#issue_messages')).includes('not decodable'));
  await broken.close();

  await context.close();
}

async function stock(browser, site, problems) {
  if (!stockRoot) {
    console.log('skip stock-page compatibility (set STOCK to a copy of upstream build/)');
    return;
  }
  const old = await serve(stockRoot),
    origin = site.url.replace(/\/$/, ''),
    context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true }),
    stockPage = await context.newPage();
  // The stock page loads d3 and canvg from a CDN; that is expected here.
  await stockPage.goto(old.url);
  await stockPage.waitForFunction(() => document.querySelectorAll('#sankey_svg rect').length > 0);

  async function capture(sample) {
    if (sample) {
      await stockPage.evaluate((s) => { window.replaceGraph(s); }, sample);
    }
    await stockPage.evaluate(() => window.openGetLinkDialog());
    const link = await stockPage.textContent('#generatedLink');
    await stockPage.evaluate(() => window.closeDialog('getLink'));
    return {
      query: new URL(link).search,
      picture: await stockPage.evaluate(() => document.getElementById('sankey_svg').innerHTML),
      // The stock page's own "Save my work" throws at this revision (an
      // upstream regression, fixed in this fork), so the file is put
      // together here in the saved-file layout from the same definition:
      saved: await stockPage.evaluate(() => {
        const lz = LZString.decompressFromEncodedURIComponent(
          new URLSearchParams(new URL(document.getElementById('generatedLink').innerText).search).get('i')
        );
        return `// SankeyMATIC diagram inputs - Saved: now\n// https://sankeymatic.com/build/\n\n`
          + `// === Nodes and Flows ===\n\n${lz}\n`;
      }),
    };
  }

  const budget = await capture(null),
    jobs = await capture('job_search'),
    finance = await capture('financial_results');

  const viaLink = await open(context, site.url + budget.query, origin, problems);
  check('stock link (default budget) opens as rows',
    await view(viaLink) === 'inout' && await viaLink.inputValue('#hub') === 'Budget'
      && await viaLink.inputValue('#rest') === 'Savings');
  check('stock link (default budget) renders exactly as the stock page did',
    await svg(viaLink) === budget.picture);
  check('stock link keeps its text until a row is edited',
    (await text(viaLink)).includes('// Enter Flows between Nodes'));
  await viaLink.waitForTimeout(700);
  await shot(viaLink, '06-desktop-stock-link');
  await setRow(viaLink, 'ins', 0, '.amt', '1600');
  check('editing a stock diagram keeps its colours',
    (await text(viaLink)).includes(':Budget #057')
      && (await text(viaLink)).includes('Budget [160] Other Necessities #606')
      && await viaLink.textContent('#left_over') === '165');
  await viaLink.close();

  for (const [name, made] of [['Job Search', jobs], ['Financial Results', finance]]) {
    const p = await open(context, site.url + made.query, origin, problems);
    check(`stock link (${name}) opens in the text view`, await view(p) === 'text');
    check(`stock link (${name}) renders exactly as the stock page did`, await svg(p) === made.picture);
    await p.close();
  }

  const file = path.join(tmp, 'stock-saved.txt');
  fs.writeFileSync(file, finance.saved);
  const viaFile = await open(context, site.url, origin, problems);
  await viaFile.setInputFiles('#load_diagram_from_file', file);
  await viaFile.waitForFunction(() => document.getElementById('flows_in').value.includes('DivisionA'));
  check('stock-format saved file (Financial Results) opens and renders the same',
    await view(viaFile) === 'text' && await svg(viaFile) === finance.picture);
  await viaFile.close();

  await context.close();
  await old.close();
}

const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
};

// Screenshots at phone width are taken in a context of their own: a
// full-page screenshot switches Chromium's touch emulation off, after which
// (pointer: coarse) no longer matches and every measurement would be of the
// desktop styles.
async function phoneShots(browser, site, problems) {
  if (!shots) { return; }
  const origin = site.url.replace(/\/$/, ''),
    context = await browser.newContext(PHONE),
    page = await open(context, site.url, origin, problems);
  // Let the rows finish fading in:
  await page.waitForTimeout(700);
  await shot(page, '07-phone-starter');
  await setRow(page, 'ins', 0, '.amt', '900');
  await page.waitForTimeout(500);
  await shot(page, '08-phone-deficit');
  await page.click('#btn_options');
  await shot(page, '09-phone-options', { fullPage: false });
  await page.click('#options_close');
  await page.click('#btn_shapes');
  await shot(page, '10-phone-other-shapes', { fullPage: false });
  await page.click('[data-sample="financial_results"]');
  await page.click('#replace_graph_yes');
  await shot(page, '11-phone-text-view');
  await context.close();
}

async function phone(browser, site, problems) {
  const origin = site.url.replace(/\/$/, ''),
    context = await browser.newContext(PHONE),
    page = await open(context, site.url, origin, problems);

  const fitsWidth = () => page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth
  );
  // Every control a finger can focus, wherever it is on the page:
  const smallControls = () => page.evaluate(() => Array.from(
    document.querySelectorAll('input, select, textarea, button')
  ).filter((e) => e.type !== 'hidden' && e.type !== 'file'
    && parseFloat(getComputedStyle(e).fontSize) < 16)
    .map((e) => e.id || e.className || e.textContent.trim()));

  check('phone: the pointer is coarse', await page.evaluate(() => matchMedia('(pointer: coarse)').matches));
  check('phone: one column, sources then diagram then destinations', await page.evaluate(() => {
    const top = (id) => document.getElementById(id).getBoundingClientRect().top,
      cols = getComputedStyle(document.getElementById('board')).gridTemplateColumns.split(' ');
    return cols.length === 1 && top('col_in') < top('stage') && top('stage') < top('col_out');
  }));
  check('phone: amounts sit on the right of every row', await page.evaluate(() => ['ins', 'outs'].every((s) => {
    const e = document.querySelector(`#${s} .entry`);
    return e.querySelector('.nm').getBoundingClientRect().left < e.querySelector('.amt').getBoundingClientRect().left;
  })));
  check('phone: no sideways scrolling', await fitsWidth());
  check('phone: the whole diagram is visible, scaled', await page.evaluate(() => {
    const fit = document.getElementById('chart_fit').getBoundingClientRect();
    return fit.left >= 0 && fit.right <= window.innerWidth;
  }));
  check('phone: every control is at least 16px', (await smallControls()).length === 0,
    (await smallControls()).join(', '));
  check('phone: remove buttons do not depend on hover', await page.evaluate(
    () => getComputedStyle(document.querySelector('.entry .rm')).opacity === '1'
  ));
  check('phone: zoom is not disabled', await page.evaluate(() => {
    const v = document.querySelector('meta[name="viewport"]').content;
    return !/user-scalable|maximum-scale|minimum-scale/.test(v);
  }));

  await setRow(page, 'ins', 0, '.amt', '900');
  check('phone: editing a row redraws', await page.textContent('#t-in') === '1,150'
    && await visible(page, 'verdict_deficit'));
  check('phone: still no sideways scrolling after an edit', await fitsWidth());

  await page.tap('#btn_options');
  check('phone: Options fills the screen', await page.evaluate(
    () => document.getElementById('options_panel').getBoundingClientRect().width === window.innerWidth
  ));
  await page.locator('summary', { hasText: 'Labels' }).first().tap();
  check('phone: every control in Options is at least 16px', (await smallControls()).length === 0,
    (await smallControls()).join(', '));
  check('phone: Options does not scroll sideways', await page.evaluate(() => {
    const p = document.getElementById('options_panel');
    return p.scrollWidth <= p.clientWidth;
  }));
  await page.tap('#options_close');

  await page.tap('#btn_shapes');
  await page.tap('[data-sample="financial_results"]');
  await page.tap('#replace_graph_yes');
  check('phone: a multi-stage sample opens as text', await view(page) === 'text');
  check('phone: text view does not scroll sideways', await fitsWidth());
  check('phone: every control in the text view is at least 16px', (await smallControls()).length === 0,
    (await smallControls()).join(', '));

  check('phone: no Content-Security-Policy violations',
    (await page.evaluate(() => window.cspViolations)).length === 0);
  check('phone: touch emulation was on for every measurement',
    await page.evaluate(() => matchMedia('(pointer: coarse)').matches));
  await context.close();
}

(async () => {
  const site = await serve(root),
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM || undefined,
      args: ['--no-sandbox'],
    }),
    problems = [];
  try {
    await desktop(browser, site, problems);
    await stock(browser, site, problems);
    await phone(browser, site, problems);
    await phoneShots(browser, site, problems);
  } finally {
    await browser.close();
    await site.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  check('no console errors, failed requests or third-party requests',
    problems.length === 0, problems.slice(0, 5).join(' | '));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
