import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyLoan } from '../server/loan-identification.js';
import { refreshLoanEvidence } from '../server/loan-evidence-refresh.js';
import { createStore } from '../server/db.js';
import { getCollectionStatus } from '../server/hourly-monitor.js';
import { createApp } from '../server/app.js';
import { serve } from './http-helper.js';
import { creditApp } from './fixtures.js';

function analyze(description: string) {
  const analysis = classifyLoan({
    title: 'Wallet',
    description,
    country: 'ph',
    store: 'google-play',
    externalId: 'alex.synthetic.loan',
  });
  for (const e of analysis.evidence.filter((e) => e.source === 'description'))
    assert.equal(description.slice(e.start, e.end), e.text);
  return analysis;
}

test('Alex OI32: Chinese range connector and actual annual parenthetical retain the upper endpoint and semantic context', () => {
  for (const expression of ['32% 到 40%', '32 到 40%', '32%-40%']) {
    const description = `Apply for a personal loan. Max APR: ${expression} (customer is not charged more than 32% - 40% in a year for a loan).`;
    const maximum = analyze(description).evidence.filter((e) => e.field === 'maximumApr');
    assert.ok(maximum.length);
    assert.ok(
      maximum.every((e) => e.numericValue === 40),
      expression,
    );
    assert.equal(maximum[0].numericMin, 32);
    assert.equal(maximum[0].numericMax, 40);
    assert.match(maximum[0].text, /in a year for a loan/);
  }
});

test('Alex OI45: savings recipient and APY remain non-loan even when loan customers are mentioned first', () => {
  for (const sentence of [
    'Loan customers earn 15% APY on savings.',
    'Save money at 15% interest, then borrow at APR 24%.',
    'Borrow at APR 24%, and save money earning 15% interest.',
  ]) {
    const evidence = analyze(
      `${sentence} Apply for a personal loan. Maximum APR 24%. Repayment 90 to 180 days.`,
    ).evidence;
    assert.ok(
      evidence.some((e) => e.field === 'savingsYield' && e.numericValue === 15),
      sentence,
    );
    assert.ok(
      !evidence.some(
        (e) => e.kind === 'financial' && (e.numericValue === 15 || e.numericMax === 15),
      ),
      sentence,
    );
    assert.ok(evidence.some((e) => e.field === 'maximumApr' && e.numericValue === 24));
  }
  const financial = analyze(
    'Deposit interest 15%. Borrow at 12% monthly interest; service fee 5%.',
  ).evidence.filter((e) => e.kind === 'financial' && e.rateType);
  assert.deepEqual(
    financial.map((e) => [e.numericValue, e.unit]),
    [[12, '%/month']],
  );
});

test('Alex OI32/45: evidence repair is atomic on audit failure and never manufactures a missing original observation time', () => {
  const store = createStore();
  try {
    const ids = [];
    for (const n of [1, 2]) {
      const app = store.createApp({
        country: 'ph',
        store: 'google-play',
        externalId: `alex.repair.${n}`,
      });
      ids.push(app.id);
      store.saveObservation(
        app.id,
        {
          ...creditApp,
          externalId: app.externalId,
          description: 'Apply for a loan. Max APR 32%-40%. Repayment 90 to 180 days.',
        },
        '2026-01-02T03:04:05.000Z',
      );
      const previous = {
        ...store.getApp(app.id)!.loanAnalysis!,
        ruleVersion: 'historical-original',
        sourceObservedAt: n === 1 ? null : '2026-01-02T03:04:05.000Z',
      };
      store.run(
        "UPDATE apps SET loan_analysis=?,classification='excluded',classification_source='manual',manual_override=1 WHERE id=?",
        JSON.stringify(previous),
        app.id,
      );
    }
    const apps = store.all('SELECT * FROM apps ORDER BY id'),
      snapshots = store.all('SELECT * FROM snapshots ORDER BY id');
    store.db.exec(
      `CREATE TEMP TRIGGER alex_audit_failure BEFORE INSERT ON research_audit WHEN NEW.action='maintenance.loan-evidence' AND NEW.target_id='${ids[1]}' BEGIN SELECT RAISE(ABORT,'Alex audit failure'); END`,
    );
    assert.throws(() => refreshLoanEvidence(store), /Alex audit failure/);
    assert.deepEqual(store.all('SELECT * FROM apps ORDER BY id'), apps);
    assert.equal(store.one('SELECT count(*) n FROM research_audit')!.n, 0);
    store.db.exec('DROP TRIGGER alex_audit_failure');
    assert.equal(refreshLoanEvidence(store).refreshed, 2);
    assert.equal(
      store.getApp(ids[0])!.loanAnalysis!.sourceObservedAt,
      null,
      'unknown prior source time stays unknown',
    );
    assert.equal(store.getApp(ids[1])!.loanAnalysis!.sourceObservedAt, '2026-01-02T03:04:05.000Z');
    assert.deepEqual(store.all('SELECT * FROM snapshots ORDER BY id'), snapshots);
    assert.ok(ids.every((id) => store.getApp(id)!.classification === 'excluded'));
    assert.equal(refreshLoanEvidence(store).refreshed, 0);
  } finally {
    store.close();
  }
});

test('Alex OI27/41: mismatched task market exposes no foreign identity and absent failure time remains null', () => {
  const store = createStore();
  try {
    const app = store.createApp({
      country: 'th',
      store: 'google-play',
      externalId: 'alex.identity',
      title: 'Correct market',
    });
    const matching = store.enqueueJob({
      type: 'refresh',
      country: 'th',
      store: 'google-play',
      appId: app.id,
    });
    const wrong = store.enqueueJob({
      type: 'refresh',
      country: 'ph',
      store: 'google-play',
      appId: app.id,
    });
    assert.equal(store.getJob(matching.id)!.externalId, 'alex.identity');
    assert.equal(store.getJob(wrong.id)!.externalId, null);
    assert.equal(store.listJobs({ country: 'ph' }).jobs[0].appTitle, null);
    const time = '2026-09-20T00:00:00Z';
    store.run(
      "INSERT INTO monitor_cycles(id,due_at,started_at,status) VALUES(1,?,?,'completed-with-errors'),(2,?,?,'running')",
      time,
      time,
      time,
      time,
    );
    for (const cycle of [1, 2])
      store.run(
        "INSERT INTO monitor_tasks(cycle_id,task_key,kind,country,store,app_id,status,error,attempts,next_run_at,created_at,finished_at,payload) VALUES(?,'alex','detail','th','google-play',?,'failed','Synthetic source error',3,?,?,?,'{}')",
        cycle,
        app.id,
        time,
        time,
        cycle === 1 ? null : time,
      );
    const status = getCollectionStatus(store);
    assert.equal(status.activeCycle!.failed, 1);
    assert.equal(status.failures.length, 2);
    assert.equal(status.failures.find((f) => f.cycleId === 1)!.failedAt, null);
    assert.equal(status.failures.find((f) => f.cycleId === 2)!.failedAt, time);
    assert.equal(status.failureScope, 'recent-cross-cycle');
  } finally {
    store.close();
  }
});

function csvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quote = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quote && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quote = !quote;
    } else if (c === ',' && !quote) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' && !quote) {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (row.length || cell) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

test('Alex OI46: later successful empty privacy retains the earlier safe same-market history through the authenticated detail API', async () => {
  const store = createStore(),
    http = await serve(createApp({ store, password: 'alex-fixture-privacy-password' }));
  try {
    const app = store.createApp({ country: 'pk', store: 'app-store', externalId: '6746167029' });
    const sibling = store.createApp({
      country: 'ph',
      store: 'app-store',
      externalId: app.externalId,
    });
    const save = (
      id: number,
      date: string,
      url: string | null,
      country: string | null = 'pk',
      status: 'available' | 'empty' = 'available',
    ) =>
      store.saveEnrichment(
        id,
        'privacy',
        {
          status,
          data: url ? { privacyPolicyUrl: url } : null,
          raw: { untouched: url },
          source: `https://apps.apple.com/${country || 'pk'}/app/id6746167029`,
          requestCountry: country,
          requestLanguage: 'en',
        },
        date,
      );
    save(app.id, '2026-01-01T00:00:00.000Z', 'https://example.test/safe-earliest');
    save(app.id, '2026-02-02T00:00:00.000Z', 'https://example.test/correct-history', 'PK');
    const expectedHistory = store.one('SELECT * FROM enrichment_history ORDER BY id DESC LIMIT 1')!;
    save(app.id, '2026-03-03T00:00:00.000Z', 'javascript:alert(1)');
    save(app.id, '2026-04-04T00:00:00.000Z', 'https://example.test/wrong-market', 'ph');
    save(app.id, '2026-05-05T00:00:00.000Z', 'https://example.test/unknown-market', null);
    save(sibling.id, '2026-06-06T00:00:00.000Z', 'https://example.test/sibling', 'ph');
    save(app.id, '2026-07-07T00:00:00.000Z', null, 'pk', 'empty');
    const before = store.all('SELECT * FROM enrichment_history ORDER BY id');
    assert.equal((await http.request(`/api/apps/${app.id}`)).status, 401);
    await http.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password: 'alex-fixture-privacy-password' }),
    });
    const response = await http.request(`/api/apps/${app.id}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.enrichments.find((e: any) => e.kind === 'privacy').status, 'empty');
    assert.equal(body.enrichments.find((e: any) => e.kind === 'privacy').data, null);
    assert.deepEqual(body.historicalPrivacy, {
      appId: app.id,
      url: 'https://example.test/correct-history',
      source: expectedHistory.source,
      fetchedAt: expectedHistory.fetched_at,
      requestCountry: 'PK',
      requestLanguage: 'en',
      historyId: expectedHistory.id,
    });
    assert.deepEqual(store.all('SELECT * FROM enrichment_history ORDER BY id'), before);
    assert.equal(
      (await (await http.request(`/api/apps/${sibling.id}`)).json()).historicalPrivacy.url,
      'https://example.test/sibling',
    );
  } finally {
    await http.close();
    store.close();
  }
});

test('Alex OI47: customer CSV freezes explicit classifications across later edits and refuses peer tokens', async () => {
  const store = createStore(),
    http = await serve(
      createApp({ store, password: 'alex-fixture-platform-password', allowedOrigins: [] }),
    );
  const client = () => {
    let cookie = '';
    return async (path: string, method = 'GET', data?: unknown) => {
      const r = await fetch(http.baseUrl + '/api' + path, {
        method,
        headers: { cookie, 'content-type': 'application/json' },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      if (r.headers.getSetCookie().length)
        cookie = r.headers
          .getSetCookie()
          .map((x) => x.split(';')[0])
          .join('; ');
      return r;
    };
  };
  try {
    const platform = client();
    assert.equal(
      (await platform('/auth/login', 'POST', { password: 'alex-fixture-platform-password' }))
        .status,
      200,
    );
    const workspace = (
      await (await platform('/workspaces', 'POST', { name: 'Alex CSV space' })).json()
    ).workspace;
    const customers = [];
    for (const email of ['admin@alex.test', 'peer@alex.test']) {
      const invite = await (
        await platform(`/workspaces/${workspace.id}/invitations`, 'POST', {
          email,
          role: email.startsWith('admin') ? 'admin' : 'viewer',
        })
      ).json();
      const request = client();
      assert.equal(
        (
          await request('/auth/accept', 'POST', {
            token: invite.token,
            name: email,
            password: 'alex-isolated-customer-password',
          })
        ).status,
        201,
      );
      customers.push(request);
    }
    for (let n = 0; n < 23; n++) {
      const app = store.createApp({
        country: 'ph',
        store: 'app-store',
        externalId: String(520000000 + n),
      });
      store.saveObservation(app.id, {
        ...creditApp,
        externalId: app.externalId,
        title: n === 0 ? '=VALUE("0,1")\nCSV' : 'Fixture ' + n,
        minInstalls: null,
        maxInstalls: null,
        installs: null,
        ratings: 0,
      });
      store.updateClassification(app.id, 'confirmed');
      if (n < 2)
        store.run(
          "INSERT INTO research_app_categories(app_id,category,reason,updated_by,updated_at) VALUES (?,?,'Fixture',0,'2026-09-20T00:00:00Z')",
          app.id,
          n === 0 ? 'personal' : 'other',
        );
    }
    const current = await (
      await customers[0]('/market/apps?loanScope=all&sort=title&limit=1')
    ).json();
    const path = '/market/apps.csv?loanScope=all&sort=title&snapshot=' + current.snapshot;
    const before = await (await customers[0](path)).text(),
      rows = csvRows(before),
      header = rows[0],
      at = (row: string[], key: string) => row[header.indexOf(key)];
    assert.equal(rows.length, 24);
    assert.deepEqual(
      new Set(rows.slice(1).map((r) => at(r, 'loanCategory'))),
      new Set(['personal', 'other', 'unknown']),
    );
    for (const row of rows.slice(1)) {
      assert.equal(
        at(row, 'loanCategoryLabel'),
        { personal: '个人现金贷', other: '其他已确认信贷', unknown: '待细分' }[
          at(row, 'loanCategory')
        ],
      );
      assert.equal(at(row, 'category'), at(row, 'loanCategory'));
      assert.equal(at(row, 'minInstalls'), '');
      assert.equal(at(row, 'ratings'), '0');
    }
    assert.ok(rows.some((row) => at(row, 'title') === '\'=VALUE("0,1")\nCSV'));
    store.run("UPDATE research_app_categories SET category='unknown'");
    assert.equal(await (await customers[0](path)).text(), before);
    assert.equal((await customers[1](path)).status, 410);
    const appId = Number(at(rows[1], 'id'));
    store.updateClassification(appId, 'excluded');
    assert.equal((await customers[0](path)).status, 410);
  } finally {
    await http.close();
    store.close();
  }
});

test('Alex OI32/45: old-source repair selects the original observation rather than binding current prose to an older timestamp', () => {
  const store = createStore();
  try {
    const app = store.createApp({ country: 'pk', store: 'app-store', externalId: '899000001' });
    const oldTime = '2026-01-01T01:02:03.000Z',
      newTime = '2026-02-02T04:05:06.000Z';
    store.saveObservation(
      app.id,
      {
        ...creditApp,
        externalId: app.externalId,
        description: 'Apply for a loan. Maximum APR 32%-40%. Repayment 90 to 180 days.',
      },
      oldTime,
    );
    const old = { ...store.getApp(app.id)!.loanAnalysis!, ruleVersion: 'historical-original' };
    store.saveObservation(
      app.id,
      {
        ...creditApp,
        externalId: app.externalId,
        description: 'Apply for a loan. Maximum APR 8%-12%. Repayment 90 to 180 days.',
      },
      newTime,
    );
    store.run('UPDATE apps SET loan_analysis=? WHERE id=?', JSON.stringify(old), app.id);
    const current = store.getApp(app.id)!,
      rawRows = store.all('SELECT * FROM snapshots ORDER BY id');
    refreshLoanEvidence(store);
    const repaired = store.getApp(app.id)!;
    assert.equal(repaired.loanAnalysis!.sourceObservedAt, oldTime);
    assert.equal(
      repaired.loanAnalysis!.evidence.find((e) => e.field === 'maximumApr')!.numericValue,
      40,
    );
    assert.equal(repaired.description, current.description);
    assert.equal(repaired.lastFetchedAt, newTime);
    assert.deepEqual(store.all('SELECT * FROM snapshots ORDER BY id'), rawRows);
  } finally {
    store.close();
  }
});

test('Alex OI32/45: missing historical source is reported and left byte-identical instead of guessing from current data', () => {
  const store = createStore();
  try {
    const app = store.createApp({
      country: 'pk',
      store: 'google-play',
      externalId: 'alex.unavailable.source',
    });
    store.saveObservation(
      app.id,
      { ...creditApp, externalId: app.externalId },
      '2026-02-02T04:05:06.000Z',
    );
    const analysis = {
      ...store.getApp(app.id)!.loanAnalysis!,
      ruleVersion: 'historical-original',
      sourceObservedAt: '2025-01-01T00:00:00.000Z',
    };
    store.run('UPDATE apps SET loan_analysis=? WHERE id=?', JSON.stringify(analysis), app.id);
    const before = store.one('SELECT * FROM apps WHERE id=?', app.id);
    const summary = refreshLoanEvidence(store);
    assert.deepEqual(summary.unavailableSourceIds, [app.id]);
    assert.equal(summary.refreshed, 0);
    assert.deepEqual(store.one('SELECT * FROM apps WHERE id=?', app.id), before);
    assert.equal(
      store.one("SELECT COUNT(*) n FROM research_audit WHERE action='maintenance.loan-evidence'")!
        .n,
      0,
    );
  } finally {
    store.close();
  }
});
