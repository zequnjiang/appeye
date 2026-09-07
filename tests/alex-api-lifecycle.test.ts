import test from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError } from '../src/api.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('Alex #21: cancelling an HTTP 200 body remains cancellation, never successful application data', async (t) => {
  const bodyStarted = deferred<void>();
  const pendingBody = deferred<unknown>();
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options?.signal, controller.signal);
    return {
      ok: true,
      status: 200,
      json: () => {
        controller.signal.addEventListener(
          'abort',
          () => pendingBody.reject(new DOMException('Cancelled response body', 'AbortError')),
          { once: true },
        );
        bodyStarted.resolve();
        return pendingBody.promise;
      },
    } as Response;
  });
  let successfulWrites = 0;
  const request = api<{ apps: unknown[] }>('/apps?country=ar', {
    signal: controller.signal,
  }).then((value) => {
    successfulWrites++;
    return value;
  });
  const rejection = assert.rejects(request, (error: unknown) =>
    error instanceof Error && error.name === 'AbortError',
  );
  await bodyStarted.promise;
  controller.abort();
  await rejection;
  assert.equal(successfulWrites, 0);
});

test('Alex #21: malformed HTTP 200 JSON is an error rather than a typed list value', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>proxy error</html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  }));
  let returnedData = false;
  await assert.rejects(
    api('/apps').then((data) => {
      returnedData = true;
      return data;
    }),
    (error: unknown) => error instanceof Error && error.name !== 'AbortError',
  );
  assert.equal(returnedData, false);
});

test('Alex #21: a real 401 still expires the session, and an ordinary server error retains its message', async (t) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const events: string[] = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { dispatchEvent: (event: Event) => { events.push(event.type); return true; } },
  });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  let response = new Response(JSON.stringify({ error: 'Session expired' }), { status: 401 });
  t.mock.method(globalThis, 'fetch', async () => response);
  await assert.rejects(api('/apps'), (error: unknown) =>
    error instanceof ApiError && error.status === 401 && error.message === 'Session expired',
  );
  assert.deepEqual(events, ['appeye:unauthorized']);
  response = new Response(JSON.stringify({ error: 'Temporary database busy' }), { status: 503 });
  await assert.rejects(api('/apps'), (error: unknown) =>
    error instanceof ApiError && error.status === 503 && error.message === 'Temporary database busy',
  );
  assert.deepEqual(events, ['appeye:unauthorized']);
});
