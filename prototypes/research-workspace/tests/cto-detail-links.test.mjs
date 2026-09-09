import test from 'node:test';
import assert from 'node:assert/strict';
import { safeExternalUrl } from '../src/utils.js';
import { createFixtures, createPendingDemo, admitCandidate, storeSource } from '../src/data.js';

test('CTO PDL: only absolute HTTP(S) addresses become links; missing and executable/malformed input do not', () => {
  for (const value of [
    'https://example.com/#demo-website',
    'http://example.com/path?q=1',
    ' HTTPS://EXAMPLE.COM/demo ',
  ])
    assert.ok(safeExternalUrl(value)?.startsWith('http'));
  for (const value of [
    null,
    undefined,
    '',
    '   ',
    42,
    {},
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,demo',
    'file:///tmp/example',
    'mailto:a@example.com',
    '//example.com/path',
    '/relative',
    'not a URL',
    'https://',
  ])
    assert.equal(safeExternalUrl(value), null, String(value));
});

test('CTO PDL: links are encoded for the exact market identity and new identities never borrow website/privacy values', () => {
  for (const country of ['th', 'ar'])
    for (const store of ['google-play', 'app-store']) {
      const app = {
        country,
        store,
        externalId: store === 'google-play' ? 'com.demo.test&query=value' : '1234/5678',
      };
      const result = new URL(storeSource(app));
      assert.ok(safeExternalUrl(result.href));
      if (store === 'google-play') {
        assert.equal(result.hostname, 'play.google.com');
        assert.equal(result.searchParams.get('id'), app.externalId);
        assert.equal(result.searchParams.get('gl'), country);
        assert.equal(result.searchParams.size, 2);
      } else {
        assert.equal(result.hostname, 'apps.apple.com');
        assert.equal(result.pathname, `/${country}/app/id1234%2F5678`);
      }
    }
  const model = createFixtures();
  const absent = model.apps.find((a) => a.id === 'th-19');
  assert.equal(absent.websiteUrl, null);
  assert.equal(absent.privacyUrl, null);
  const invalid = model.apps.find((a) => a.id === 'ar-22');
  assert.equal(safeExternalUrl(invalid.websiteUrl), null);
  assert.equal(safeExternalUrl(invalid.privacyUrl), null);
  assert.equal(new URL(model.apps[0].websiteUrl).hash, '#demo-website');
  assert.equal(new URL(model.apps[0].privacyUrl).hash, '#demo-privacy');
  const pending = createPendingDemo(model.apps, model.events).apps.find(
    (a) => a.id === 'th-new-demo',
  );
  assert.equal(pending.websiteUrl, null);
  assert.equal(pending.privacyUrl, null);
  for (const candidate of model.candidates) {
    const admitted = admitCandidate(model, candidate.id).apps.at(-1);
    assert.equal(admitted.websiteUrl, null);
    assert.equal(admitted.privacyUrl, null);
  }
});
