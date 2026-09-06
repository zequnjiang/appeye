import test from 'node:test';
import assert from 'node:assert/strict';
import { describeTransportError } from '../server/transport-error.js';
import { createFullScanProviders } from '../server/full-scan-providers.js';
import { createFullScanRunner } from '../server/full-scan.js';
import { createStore } from '../server/db.js';

test('FS-AC-09: transport diagnostics retain bounded causes without serializing stack, body, extra fields or unsafe getters', () => {
  assert.equal(describeTransportError(new Error('fetch failed')), 'fetch failed');
  assert.equal(describeTransportError(new Error('x'.repeat(3000))).length, 2000);
  const inner = Object.assign(new Error('inner reason'), {
    code: 'INNER',
    stack: 'PRIVATE_STACK',
    body: 'PRIVATE_BODY',
    cause: new Error('THIRD_LAYER'),
  });
  const first = Object.assign(new Error('redirect count exceeded'), {
    code: 'REDIRECT',
    cause: inner,
    secret: 'PRIVATE_EXTRA',
  });
  const error = new TypeError('fetch failed', { cause: first });
  const text = describeTransportError(error);
  assert.match(text, /^fetch failed \| causes: /);
  assert.deepEqual(JSON.parse(text.split(' | causes: ')[1]), [
    { name: 'Error', message: 'redirect count exceeded', code: 'REDIRECT' },
    { name: 'Error', message: 'inner reason', code: 'INNER' },
  ]);
  assert.doesNotMatch(text, /PRIVATE_|THIRD_LAYER/);
  const cycle = new Error('cycle');
  Object.defineProperty(cycle, 'cause', { value: cycle });
  assert.equal(describeTransportError(cycle), 'cycle');
  const unsafe = new Error('unsafe getter');
  Object.defineProperty(unsafe, 'cause', {
    get: () => {
      throw new Error('must not propagate');
    },
  });
  assert.equal(describeTransportError(unsafe), 'unsafe getter');
  const huge = new Error('top', {
    cause: { name: 'n'.repeat(150), message: 'm'.repeat(1500), code: 'c'.repeat(150) },
  });
  const limited = JSON.parse(describeTransportError(huge).split(' | causes: ')[1])[0];
  assert.equal(limited.name.length, 100);
  assert.equal(limited.message.length, 1000);
  assert.equal(limited.code.length, 100);
});

test('FS-AC-09: injected fetch failure records its cause in the HTTP ledger and rethrows the original error object', async () => {
  const store = createStore();
  const error = new TypeError('fetch failed', {
    cause: Object.assign(new Error('redirect count exceeded'), { code: 'TEST_REDIRECT' }),
  });
  let runner: ReturnType<typeof createFullScanRunner>;
  const providers = createFullScanProviders({
    requestDelayMs: 0,
    fetchImpl: async () => {
      throw error;
    },
    onResponse: (record) => runner.recordHttp(record),
    googlePlayClient: {
      app: async () => ({}),
      search: async () => [],
      reviews: async () => [],
      list: async (options: any) =>
        options.requestOptions.fetchImpl('https://play.google.com/store/apps/category/FINANCE'),
    },
  });
  runner = createFullScanRunner({
    store,
    providers,
    batchId: 'diagnostic-only-fixture',
    config: { countries: ['ph'], stores: ['google-play'], includeSearch: false },
  });
  try {
    await assert.rejects(
      providers['google-play'].list({ collection: 'TOP_FREE', country: 'ph', language: 'en' }),
      (caught) => caught === error,
    );
    const records = store.all('SELECT * FROM full_scan_http');
    assert.equal(records.length, 1);
    assert.equal(records[0].status, null);
    assert.equal(records[0].body, null);
    assert.equal(records[0].batch_id, runner.batchId);
    assert.match(records[0].error, /^fetch failed \| causes: /);
    assert.match(records[0].error, /redirect count exceeded/);
    assert.match(records[0].error, /TEST_REDIRECT/);
  } finally {
    store.close();
  }
});
