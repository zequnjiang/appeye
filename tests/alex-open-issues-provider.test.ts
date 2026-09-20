import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRelatedContinuation } from '../server/related-continuation.js';

function row(id = 'alex.synthetic.one') {
  const r: any[] = [];
  r[12] = [id];
  r[9] = [];
  r[9][4] = [];
  r[9][4][2] = '/store/apps/details?id=' + id;
  r[2] = 'Synthetic related title';
  r[1] = [];
  r[1][1] = [];
  r[1][1][0] = [];
  r[1][1][0][3] = [];
  r[1][1][0][3][2] = 'https://example.test/icon.png';
  r[4] = [[['Fixture publisher']]];
  return r;
}
function response(items: any[], token: unknown = null) {
  const compact: any[] = [items];
  compact[7] = token;
  const payload = [[compact]];
  return (
    ")]}'\n" + JSON.stringify([['wrb.fr', 'qnKhOb', JSON.stringify(payload), null, null, null]])
  );
}

test('Alex OI24: only explicit null container changes; identity rows, order, duplicate evidence and other RPCs remain exact', () => {
  const items = [row(), row('alex.synthetic.two'), row()];
  const original = response(items),
    out = normalizeRelatedContinuation(original);
  assert.deepEqual(out.adaptation, {
    kind: 'related-null-token-container',
    apps: 3,
    path: '0.0.7',
    originalValue: null,
    sdkValue: [null, null],
  });
  const parsed = JSON.parse(out.body),
    payload = JSON.parse(parsed[0][2]);
  assert.deepEqual(payload[0][0][0], JSON.parse(JSON.stringify(items)));
  assert.deepEqual(payload[0][0][7], [null, null]);
  const unchanged = normalizeRelatedContinuation(out.body);
  assert.equal(unchanged.body, out.body);
  assert.equal(unchanged.adaptation, undefined);
  for (const token of [[null, 'real-synthetic-cursor'], [], false, 'cursor']) {
    const body = response(items, token);
    assert.equal(normalizeRelatedContinuation(body).body, body);
  }
});

test('Alex OI24: mismatched identity, foreign origin, competing layout and non-target RPC cannot be silently normalized', () => {
  const cases = [];
  const different = row();
  different[9][4][2] = '/store/apps/details?id=other.identity';
  cases.push(response([different]));
  const foreign = row();
  foreign[9][4][2] = 'https://evil.example/store/apps/details?id=alex.synthetic.one';
  cases.push(response([foreign]));
  const duplicateParam = row();
  duplicateParam[9][4][2] = '/store/apps/details?id=alex.synthetic.one&id=other';
  cases.push(response([duplicateParam]));
  const broken = row();
  delete broken[12];
  cases.push(response([broken]));
  const frame = JSON.parse(response([row()]).slice(5));
  const payload = JSON.parse(frame[0][2]);
  payload[0][6] = [[row()]];
  frame[0][2] = JSON.stringify(payload);
  cases.push(JSON.stringify(frame));
  cases.push(response([row()]).replace('qnKhOb', 'OtherRPC'));
  cases.push('<html>Error</html>');
  cases.push(')]}\'\n[["wrb.fr","qnKhOb",null,null,null,[5]]]');
  for (const body of cases) {
    const out = normalizeRelatedContinuation(body);
    assert.equal(out.body, body);
    assert.equal(out.adaptation, undefined);
  }
});

test('Alex OI24: RPC source errors and ambiguous duplicate frames retain exact source instead of a natural end', () => {
  const frames = JSON.parse(response([row()]).slice(5));
  frames[0][5] = [5, 'source unavailable'];
  const error = JSON.stringify(frames);
  const out = normalizeRelatedContinuation(error);
  assert.equal(out.body, error);
  assert.equal(out.warning?.reason, 'related-source-error');
  assert.equal(out.adaptation, undefined);
  const ok = JSON.parse(response([row()]).slice(5));
  const ambiguous = JSON.stringify([ok[0], structuredClone(ok[0])]);
  const result = normalizeRelatedContinuation(ambiguous);
  assert.equal(result.body, ambiguous);
  assert.equal(result.warning?.reason, 'related-ambiguous-rpc');
  assert.equal(result.adaptation, undefined);
});
