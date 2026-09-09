import { latestMarketObservation } from '../src/utils.js';
import { openDialogWithReturn } from '../src/dialog-lifecycle.js';
import { requestDownload } from '../src/download.js';
import { isCustomerRole } from '../src/utils.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtures, admitCandidate, createPendingDemo, DEMO_DAY } from '../src/data.js';
import { marketCounts, exportResearch } from '../src/utils.js';

test('CTO: candidate admission is an immutable identity transaction and repeated review is idempotent', () => {
  const original = createFixtures(),
    before = structuredClone(original),
    candidate = original.candidates[0];
  const admitted = admitCandidate(original, candidate.id),
    app = admitted.apps.find((a) => a.id === `admitted-${candidate.id}`);
  assert.deepEqual(original, before);
  assert.equal(admitted.apps.length, 133);
  assert.equal(app.externalId, candidate.externalId);
  assert.equal(new URL(app.source).searchParams.get('id'), app.externalId);
  assert.equal(admitted.events.find((e) => e.appId === app.id).source, app.source);
  assert.equal(admitted.candidates.find((c) => c.id === candidate.id).appId, app.id);
  assert.equal(marketCounts(admitted.apps, admitted.events).th.firstSeen, 9);
  assert.equal(admitCandidate(admitted, candidate.id), admitted);
  const collision = { ...candidate, id: 'duplicate-source', status: 'pending' };
  const again = admitCandidate(
    { ...admitted, candidates: [...admitted.candidates, collision] },
    collision.id,
  );
  assert.equal(again.apps.length, 133);
  assert.equal(again.events.length, admitted.events.length);
  assert.equal(again.candidates.at(-1).appId, app.id);
  const excluded = {
    ...original,
    candidates: original.candidates.map((c) =>
      c.id === candidate.id ? { ...c, status: 'excluded' } : c,
    ),
  };
  assert.equal(admitCandidate(excluded, candidate.id), excluded);
});

test('CTO: every event source has coherent observation time, with release dates retaining day precision', () => {
  const { apps, events } = createFixtures();
  for (const event of events) {
    const app = apps.find((a) => a.id === event.appId);
    assert.equal(event.source, app.source);
    assert.ok(Date.parse(event.observedAt) <= Date.parse(app.lastFetchedAt), event.id);
    assert.ok(
      Date.parse(app.firstSeenAt) <= Date.parse(event.observedAt),
      `first seen after source ${event.id}`,
    );
    if (event.type === 'firstSeen') assert.equal(event.at, app.firstSeenAt);
    if (event.type === 'storeRelease') {
      assert.equal(event.releasePrecision, 'date');
      assert.equal(event.releasedAt, app.releasedAt);
      assert.match(event.releasedAt, /^\d{4}-\d{2}-\d{2}$/);
    }
  }
  assert.ok(events.some((e) => e.date !== DEMO_DAY));
  assert.ok(events.some((e) => e.field === 'seller'));
  assert.ok(events.some((e) => e.field === 'loanTerm'));
});

test('CTO: demonstrable missing, unsupported, empty and retained failure permission states remain distinct', () => {
  const { apps } = createFixtures(),
    gp = apps.filter((a) => a.store === 'google-play');
  assert.deepEqual(
    new Set(gp.map((a) => a.permissionStatus)),
    new Set(['available', 'empty', 'failed', 'uncollected']),
  );
  const failed = gp.find((a) => a.permissionStatus === 'failed');
  assert.ok(failed.permissions.length > 6);
  assert.ok(failed.permissionError);
  assert.ok(Date.parse(failed.permissionFetchedAt) < Date.parse(failed.lastFetchedAt));
  assert.ok(gp.find((a) => a.permissionStatus === 'empty').permissions.length === 0);
  assert.ok(gp.some((a) => a.permissions.some((p) => typeof p === 'string')));
  assert.ok(gp.some((a) => a.permissions.some((p) => p?.type === 0 && p.unknownField)));
  assert.ok(
    apps
      .filter((a) => a.store === 'app-store')
      .every(
        (a) =>
          a.permissionStatus === 'unsupported' && a.permissions === null && a.minInstalls === null,
      ),
  );
  assert.equal(apps.filter((a) => a.screenshots.length).length, 2);
  const broken = apps.find((a) => a.id === 'th-9');
  assert.equal(broken.screenshotStatus, 'demo-load-failure');
  assert.match(broken.description, /故意/);
  assert.match(broken.screenshotNote, /本地不存在/);
  assert.deepEqual(broken.screenshots, ['/assets/intentional-missing-demo.png']);
});

test('CTO: per-space groups, collections, same-app notes and exported references remain independently owned', () => {
  const { apps, workspaces } = createFixtures();
  for (const w of Object.values(workspaces)) {
    assert.equal(w.groups.length, 2);
    assert.equal(w.collections.length, 2);
    assert.ok(w.notes.every((n) => n.source));
  }
  const north = workspaces.north.notes.find((n) => n.appId === 'th-1'),
    south = workspaces.south.notes.find((n) => n.appId === 'th-1');
  assert.notEqual(north.text, south.text);
  const result = exportResearch(workspaces.north, apps);
  assert.match(result, /com\.th\.creditdemo1/);
  assert.ok(result.includes(north.text));
  assert.ok(!result.includes(south.text));
  const pending = createPendingDemo(apps, createFixtures().events);
  assert.equal(pending.apps.find((a) => a.id === 'th-new-demo').screenshots.length, 0);
});

test('CTO: customer roles and unavailable permission timestamps cannot imply unsupported authority or success', () => {
  for (const value of ['admin', 'researcher', 'viewer']) assert.equal(isCustomerRole(value), true);
  for (const value of ['platform', 'owner', '', null, undefined, {}, ['admin']])
    assert.equal(isCustomerRole(value), false);
  for (const app of createFixtures().apps.filter((a) =>
    ['unsupported', 'uncollected'].includes(a.permissionStatus),
  ))
    assert.equal(app.permissionFetchedAt, null);
});

test('CTO: download attaches its link before activation and retains its URL for delayed browser consumption', () => {
  const actions = [],
    anchor = {
      click() {
        assert.equal(this.connected, true);
        actions.push('click');
      },
      remove() {
        this.connected = false;
        actions.push('remove');
      },
    },
    timers = [];
  const environment = {
    document: {
      createElement: () => anchor,
      body: {
        append(a) {
          a.connected = true;
          actions.push('append');
        },
      },
    },
    URL: {
      createObjectURL(blob) {
        assert.equal(blob.type, 'text/markdown;charset=utf-8');
        return 'blob:example';
      },
      revokeObjectURL(url) {
        actions.push(url);
      },
    },
    Blob,
    setTimeout(fn, ms) {
      timers.push([fn, ms]);
    },
  };
  requestDownload('demo.md', '# 示例研究', environment);
  assert.deepEqual(actions, ['append', 'click', 'remove']);
  assert.equal(anchor.href, 'blob:example');
  assert.equal(anchor.download, 'demo.md');
  assert.equal(timers[0][1], 60000);
  timers[0][0]();
  assert.equal(actions.at(-1), 'blob:example');
});

test('CTO: StrictMode modal replay retains original trigger and restores it only after the final close', () => {
  const queued = [],
    calls = [],
    dialog = {
      open: false,
      showModal() {
        this.open = true;
      },
      close() {
        this.open = false;
      },
    },
    trigger = {
      isConnected: true,
      ownerDocument: {
        querySelector() {
          return dialog.open ? dialog : null;
        },
      },
      focus(options) {
        calls.push(options);
      },
    };
  const firstCleanup = openDialogWithReturn(dialog, trigger, (fn) => queued.push(fn));
  firstCleanup();
  const finalCleanup = openDialogWithReturn(dialog, trigger, (fn) => queued.push(fn));
  queued.shift()();
  assert.equal(calls.length, 0, 'must not focus an inert trigger behind replayed modal');
  finalCleanup();
  queued.shift()();
  assert.deepEqual(calls, [{ preventScroll: true }]);
  trigger.isConnected = false;
  openDialogWithReturn(dialog, trigger, (fn) => queued.push(fn))();
  queued.shift()();
  assert.equal(calls.length, 1, 'removed route triggers must not steal focus');
});

test('CTO: recent market text is selected from the same dated and classified event evidence', () => {
  const model = createFixtures(),
    before = structuredClone(model),
    latest = latestMarketObservation(model.apps, model.events, { country: 'th', day: DEMO_DAY });
  const eligible = model.events.filter(
    (e) =>
      e.country === 'th' &&
      e.date === DEMO_DAY &&
      model.apps.find((a) => a.id === e.appId)?.loanType === 'personal',
  );
  assert.equal(
    Date.parse(latest.observedTime),
    Math.max(...eligible.map((e) => Date.parse(e.observedAt))),
  );
  assert.equal(latest.title, model.apps.find((a) => a.id === latest.appId).title);
  assert.equal(latest.source, eligible.find((e) => e.id === latest.id).source);
  assert.equal(
    latestMarketObservation(model.apps, model.events, { country: 'th', day: '2026-09-10' }),
    null,
  );
  assert.equal(
    latestMarketObservation(model.apps, model.events, { country: 'th', day: '2026-09-07' }).id,
    'th-19-historical-update',
  );
  const pending = createPendingDemo(model.apps, model.events);
  assert.deepEqual(
    latestMarketObservation(model.apps, model.events, { country: 'th', day: DEMO_DAY }),
    latest,
  );
  assert.equal(
    latestMarketObservation(pending.apps, pending.events, { country: 'th', day: DEMO_DAY }).appId,
    'th-new-demo',
  );
  assert.deepEqual(model, before);
});
