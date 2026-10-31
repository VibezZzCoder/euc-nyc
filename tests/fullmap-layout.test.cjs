const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const css = readFileSync(join(__dirname, '../css/style.css'), 'utf8');

// Inspect the height-only policy, not a guessed browser text-height or a captured pixel rectangle.
function shortMapPolicy() {
  for (const match of css.matchAll(/@media\s*\(max-height:\s*500px\)\s*\{/g)) {
    let end = match.index + match[0].length, depth = 1;
    const start = end;
    while (depth && end < css.length) {
      if (css[end] === '{') depth++;
      if (css[end] === '}') depth--;
      end++;
    }
    const body = css.slice(start, end - 1);
    if (body.includes('.fullmap-credits')) return body;
  }
  assert.fail('short-height map policy must also cover wide landscape windows');
}

function rule(body, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, selector); return match[1];
}

test('short maps use the entire safe-area credit width, bound tall copy and preserve scrollable attribution links', () => {
  const policy = shortMapPolicy(), credits = rule(policy, '.fullmap-credits');
  assert.match(credits, /left:\s*var\(--safe-left\)/);
  assert.match(credits, /right:\s*var\(--safe-right\)/);
  assert.match(credits, /width:\s*auto/); assert.match(credits, /max-width:\s*none/);
  assert.doesNotMatch(credits, /50%|440px/, 'short-wide attribution must not inherit the desktop side-column budget');
  assert.match(credits, /max-height:\s*calc\(100dvh\s*-\s*var\(--safe-top\)\s*-\s*var\(--safe-bottom\)/);
  assert.match(credits, /overflow-y:\s*auto/); assert.match(credits, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(credits, /display:\s*none|overflow:\s*hidden|text-overflow:\s*ellipsis/);
});

test('short-map actions keep 44px targets below the header; footer and results reserve measured attribution/feedback', () => {
  const policy = shortMapPolicy(), controls = rule(policy, '.map-controls'), target = rule(policy, '.map-controls .icon-btn');
  assert.match(controls, /top:\s*calc\(var\(--safe-top\)\s*\+\s*62px\)/);
  assert.match(controls, /flex-direction:\s*row/);
  assert.match(target, /width:\s*44px/); assert.match(target, /height:\s*44px/);
  const footer = rule(policy, '.fullmap-footer');
  assert.match(footer, /var\(--map-credits-height,/);
  assert.match(footer, /left:\s*var\(--safe-left\)/); assert.match(footer, /right:\s*var\(--safe-right\)/);
  const results = rule(policy, '.fullmap-search-results');
  assert.match(results, /var\(--map-credits-height,/); assert.match(results, /var\(--map-status-height,/);
  assert.match(results, /100dvh/);
});
