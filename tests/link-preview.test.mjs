// A shared link shows a picture: index.html names an image that this repository serves from the hosted site.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
const SITE = 'https://vibezzzcoder.github.io/euc-nyc/';
const meta = key => {
  const match = html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`));
  return match ? match[1] : null;
};

/** Width and height from a JPEG's frame header. */
function jpegSize(bytes) {
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) throw new Error('not a JPEG segment');
    const marker = bytes[at + 1], length = bytes.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    }
    at += 2 + length;
  }
  throw new Error('no JPEG frame header');
}

test('the link preview names a picture served by this site', () => {
  assert.equal(meta('og:url'), SITE);
  const image = meta('og:image');
  assert.ok(image?.startsWith(SITE), 'og:image is on the hosted site');
  assert.equal(meta('twitter:image'), image);
  assert.equal(meta('twitter:card'), 'summary_large_image');
  for (const key of ['og:title', 'og:description', 'og:image:alt', 'twitter:title', 'twitter:description', 'twitter:image:alt']) {
    assert.ok(meta(key)?.trim(), `${key} is filled in`);
  }
  const file = new URL(image.slice(SITE.length), root);
  const bytes = fs.readFileSync(file);
  assert.deepEqual([bytes[0], bytes[1]], [0xff, 0xd8], 'the picture is a JPEG');
  assert.equal(meta('og:image:type'), 'image/jpeg');
  const size = jpegSize(bytes);
  assert.equal(String(size.width), meta('og:image:width'));
  assert.equal(String(size.height), meta('og:image:height'));
  assert.ok(bytes.length < 400_000, 'small enough for link-preview fetchers');
});
