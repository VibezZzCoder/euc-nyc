const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const css = readFileSync(join(__dirname, '../css/style.css'), 'utf8');
const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
const rule = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, selector);
  return match[1];
};
const px = (body, property) => {
  const match = body.match(new RegExp(`(?:^|[;\\s])${property}:\\s*([\\d.]+)px`));
  assert.ok(match, property);
  return Number(match[1]);
};

test('narrow-touch FPS panel clears the existing gauge with room for its focus ring', () => {
  const fps = rule('body.touch-enabled .fps-control');
  const width = px(fps, 'width');
  const gauge = px(rule('body.touch-enabled .cluster'), 'width');
  const edge = Number(css.match(/@media \(max-width: 820px\)\s*\{\s*:root \{ --edge: (\d+)px/)[1]);
  const focus = rule(':focus-visible');
  const ring = px(focus, 'outline') + px(focus, 'outline-offset');
  assert.match(fps, /flex-direction: column/);
  for (const viewport of [320, 360, 390, 620, 820]) {
    const panelRight = edge + width;
    const gaugeLeft = viewport - edge - gauge;
    assert.ok(panelRight + ring < gaugeLeft, `${viewport}px: panel/focus ${panelRight + ring}, gauge ${gaugeLeft}`);
  }
  assert.match(css, /@media \(max-width: 820px\)\s*\{[^{}]*body\.touch-enabled \.fps-control/,
    'compact layout is scoped to narrow touch screens');
  assert.match(rule('.fps-label-short'), /display: none/);
  assert.match(rule('body.touch-enabled .fps-label-full'), /display: none/);
});

test('compact FPS select retains full accessible naming, short options and a 44px touch target', () => {
  const select = html.match(/<select id="fps-limit"[^>]*>([\s\S]*?)<\/select>/)[0];
  assert.match(select, /aria-label="Frame rate"/);
  const options = [...select.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(options, [['auto', 'Auto'], ['120', '120'], ['60', '60'], ['30', '30']]);
  const panel = rule('body.touch-enabled .fps-control');
  const control = rule('body.touch-enabled #fps-limit');
  assert.ok(px(control, 'min-height') >= 44);
  const padding = Number(panel.match(/padding:\s*[\d.]+px\s+([\d.]+)px/)[1]);
  const border = px(rule('.panel'), 'border');
  assert.ok(px(panel, 'width') - 2 * (padding + border) >= 44, 'native target width stays at least 44px');
  assert.match(control, /width: 100%/);
  assert.match(html, /class="fps-label-short" aria-hidden="true">FPS<\/span>/);
});

test('compact touch hint clears the FPS panel and uses a bounded four-line left gutter on small phones', () => {
  const hints = [...css.matchAll(/body\.touch-enabled \.touch-look-hint\s*\{([^}]+)\}/g)].map((m) => m[1]);
  assert.equal(hints.length, 2);
  const top = Number(hints[0].match(/\+ (\d+)px/)[1]);
  const panel = rule('body.touch-enabled .fps-control');
  const panelPaddingY = Number(panel.match(/padding:\s*(\d+)px/)[1]);
  const border = px(rule('.panel'), 'border');
  const panelHeight = 2 * (panelPaddingY + border) + px(rule('body.touch-enabled .fps-label-short'), 'line-height')
    + px(panel, 'gap') + px(rule('body.touch-enabled #fps-limit'), 'min-height');
  // Existing <=820 header top + brand height + FPS margin, relative to the safe-area edge.
  const headerOffset = Number(css.match(/\.hud-top-left \{ top: calc\([^;]+\+ (\d+)px/)[1]);
  const brandHeight = Number(css.match(/\.brand \{ height: (\d+)px; padding: 0 12px/)[1]);
  const panelBottom = headerOffset + brandHeight + px(rule('.fps-control'), 'margin-top') + panelHeight;
  assert.ok(top >= panelBottom + 10, 'hint starts at least 10px below the FPS panel');
  const narrow = hints[1], gutter = px(narrow, 'width');
  assert.equal(px(narrow, 'max-width'), gutter);
  const edge = 12, gaugeLeft = 320 - edge - px(rule('body.touch-enabled .cluster'), 'width');
  assert.ok(edge + gutter + 8 <= gaugeLeft, 'hint stays left of the small-phone gauge');
  const short = html.match(/class="touch-look-hint-short">([^]*?)<\/span>/)[1];
  assert.deepEqual(short.split('<br>'), ['Drag', 'to look', 'Pinch', 'to zoom']);
  assert.match(rule('body.touch-enabled .touch-look-hint-short'), /white-space: nowrap/);
  const hintBottom = edge + top + 4 * px(narrow, 'line-height');
  assert.ok(hintBottom <= 260, 'four lines leave 10px above the observed 320x568 street signs at y=270');
  assert.match(rule('.touch-look-hint-short'), /display: none/);
  assert.match(rule('.touch-look-hint'), /\+ 120px/, 'wide-screen hint keeps its existing position');
});
