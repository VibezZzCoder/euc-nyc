// The page's Content-Security-Policy: same-origin only, in step with the inline scripts, and placed before them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPolicy, inlineScripts, policiesIn } from '../tools/csp.mjs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('index.html carries exactly one policy and it matches its inline scripts', () => {
  const found = policiesIn(html);
  assert.equal(found.length, 1);
  assert.equal(found[0], buildPolicy(html), 'run: node tools/csp.mjs');
  assert.equal(inlineScripts(html).length, 2, 'the scroll guard and the import map');
});

test('the policy names no other host and allows no unhashed inline or evaluated script', () => {
  const [policy] = policiesIn(html);
  assert.doesNotMatch(policy, /https?:|\*|unsafe-inline|unsafe-eval|unsafe-hashes|wasm-unsafe-eval|blob:/);
  const directives = Object.fromEntries(policy.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)]));
  assert.deepEqual(directives['default-src'], ["'none'"]);
  assert.equal(directives['script-src'][0], "'self'");
  assert.ok(directives['script-src'].slice(1).every((s) => /^'sha256-[A-Za-z0-9+/]{43}='$/.test(s)));
  for (const name of ['worker-src', 'style-src', 'font-src', 'connect-src', 'media-src', 'manifest-src']) {
    assert.deepEqual(directives[name], ["'self'"], name);
  }
  assert.deepEqual(directives['img-src'], ["'self'", 'data:']);
});

test('the policy comes before every script, right after the charset declaration', () => {
  const policyAt = html.indexOf('http-equiv="Content-Security-Policy"');
  assert.ok(policyAt > 0 && policyAt < html.indexOf('<script'));
  const charsetAt = html.indexOf('<meta charset="UTF-8" />');
  assert.ok(charsetAt > 0 && charsetAt < policyAt && charsetAt < 1024);
});

test('the page has nothing the policy would block: no inline handlers, style attributes or other-host loads', () => {
  const tags = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '<script></script>').match(/<[a-zA-Z][^>]*>/g);
  for (const tag of tags) {
    assert.doesNotMatch(tag, /\son[a-z]+\s*=/, tag);
    assert.doesNotMatch(tag, /\sstyle\s*=/, tag);
    if (/^<(script|link|img|iframe|source|audio|video|object|embed)\b/.test(tag)) {
      assert.doesNotMatch(tag, /(?:src|href)\s*=\s*"(?:[a-z][a-z0-9+.-]*:)?\/\//i, tag);
    }
  }
  assert.doesNotMatch(html, /<style\b|<base\b|integrity=/);
});
