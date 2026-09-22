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
  const input = {
    title: 'Loan and Savings',
    description,
    store: 'google-play' as const,
    country: 'ph',
    externalId: 'test.loan',
  };
  const analysis = classifyLoan(input);
  for (const evidence of analysis.evidence)
    assert.equal(input[evidence.source]?.slice(evidence.start, evidence.end), evidence.text);
  return analysis;
}

test('#32 APR ranges bind both endpoints, preserve raw span and never use the low endpoint as maximum', () => {
  for (const expression of [
    '32%-40%',
    '32%–40%',
    '32–40%',
    '32 to 40%',
    '32％ — 40％',
    '32,5%-40,5%',
  ]) {
    const analysis = analyze(
      `Apply for a personal loan. Max APR: ${expression} (customer is not charged more than this in a year for a loan). Repayment 90 to 180 days.`,
    );
    const claim = analysis.evidence.find((e) => e.field === 'maximumApr')!;
    assert.ok(claim.text.includes(expression));
    assert.equal(claim.numericMin, expression.includes(',5') ? 32.5 : 32);
    assert.equal(claim.numericMax, expression.includes(',5') ? 40.5 : 40);
    assert.equal(claim.numericValue, claim.numericMax);
    assert.equal(claim.unit, '%/year');
  }
  const unqualified = analyze('Apply for a loan. APR 10%–25%. Loan term 90 days.').evidence.find(
    (e) => e.field === 'rate',
  )!;
  assert.equal(unqualified.numericValue, undefined);
  assert.equal(unqualified.numericMax, 25);
  const adjacent = analyze(
    'Apply for a loan. Maximum interest 20% monthly and maximum APR 24%-40%. Service fee 5%.',
  ).evidence;
  assert.ok(
    adjacent.some(
      (e) => e.field === 'maximumInterestRate' && e.numericValue === 20 && e.unit === '%/month',
    ),
  );
  assert.ok(adjacent.some((e) => e.field === 'maximumApr' && e.numericValue === 40));
  assert.ok(!adjacent.some((e) => e.field === 'maximumApr' && e.numericValue === 5));
});

test('#45 saving money yields are non-loan evidence; distinct borrowing claims remain attributable', () => {
  for (const phrase of [
    'start saving money and earn up to 15% interest per year',
    'Savings interest 15%',
    'Deposit APY 15%',
    'ahorro interés 15%',
    'tabungan bunga 15%',
  ]) {
    const analysis = analyze(
      `With our wallet, ${phrase}. Apply for a personal loan. Max APR 24%-40%. Loan repayment term 90 to 180 days.`,
    );
    const savings = analysis.evidence.find((e) => e.field === 'savingsYield')!;
    assert.ok(savings, phrase);
    assert.equal(savings.kind, 'non-loan');
    assert.equal(savings.weight, 0);
    assert.ok(!analysis.evidence.some((e) => e.kind === 'financial' && e.numericValue === 15));
    assert.ok(analysis.evidence.some((e) => e.field === 'maximumApr' && e.numericValue === 40));
  }
  const sameSentence = analyze('Earn savings interest 15% and borrow a loan with maximum APR 24%.');
  assert.ok(sameSentence.evidence.some((e) => e.field === 'maximumApr' && e.numericValue === 24));
  const savingOnly = analyze(
    'Apply for a loan. Save money and earn interest 15%. Repayment 90 to 180 days.',
  );
  assert.notEqual(
    savingOnly.verdict,
    'strong',
    'Savings cannot supply a second independent loan disclosure family',
  );
});

test('#32/#45 existing analyses repair preserves classifications, observation identities and previous evidence with idempotent audit', () => {
  const store = createStore();
  try {
    const ids = ['auto', 'manual', 'legacy'].map((mode, i) => {
      const app = store.createApp({
        store: 'google-play',
        country: 'ph',
        externalId: `fixture.${mode}`,
      });
      store.saveObservation(app.id, {
        ...creditApp,
        externalId: app.externalId,
        description: 'Apply for a personal loan. Max APR 32%-40%. Loan term 90 to 180 days.',
      });
      const previous = {
        ...store.getApp(app.id)!.loanAnalysis!,
        ruleVersion: 'historical/heuristics-2',
      };
      store.run(
        'UPDATE apps SET loan_analysis=?,classification=?,classification_source=?,manual_override=? WHERE id=?',
        JSON.stringify(previous),
        i === 0 ? 'candidate' : i === 1 ? 'excluded' : 'confirmed',
        mode,
        i === 0 ? 0 : 1,
        app.id,
      );
      return app.id;
    });
    const before = store.all(
      'SELECT id,country,store,external_id,classification,classification_source,manual_override,first_seen_at,last_seen_at,last_fetched_at,data FROM apps',
    );
    const histories = store.all('SELECT * FROM snapshots');
    const first = refreshLoanEvidence(store);
    assert.equal(first.refreshed, 3);
    assert.equal(first.networkRequests, 0);
    assert.deepEqual(
      store.all(
        'SELECT id,country,store,external_id,classification,classification_source,manual_override,first_seen_at,last_seen_at,last_fetched_at,data FROM apps',
      ),
      before,
    );
    assert.deepEqual(store.all('SELECT * FROM snapshots'), histories);
    assert.equal(
      store.one("SELECT COUNT(*) n FROM research_audit WHERE action='maintenance.loan-evidence'")!
        .n,
      3,
    );
    for (const id of ids) {
      const audit = JSON.parse(
        store.one('SELECT detail FROM research_audit WHERE target_id=?', String(id))!.detail,
      );
      assert.equal(audit.previous.ruleVersion, 'historical/heuristics-2');
      assert.equal(audit.previous.sourceObservedAt, audit.next.sourceObservedAt);
      assert.equal(audit.next.evidence.find((e: any) => e.field === 'maximumApr').numericValue, 40);
    }
    assert.equal(refreshLoanEvidence(store).refreshed, 0);
    assert.equal(store.one('SELECT COUNT(*) n FROM research_audit')!.n, 3);
  } finally {
    store.close();
  }
});

test('#27 jobs expose correctly joined identity and #41 failures keep time and cycle, separate from active totals', () => {
  const store = createStore();
  try {
    const app = store.createApp({
      store: 'google-play',
      country: 'ph',
      externalId: 'fixture.task',
      title: 'A named application',
    });
    const job = store.enqueueJob({
      type: 'refresh',
      country: 'ph',
      store: 'google-play',
      appId: app.id,
    });
    const found = store
      .listJobs({ status: 'queued', country: 'ph' })
      .jobs.find((j) => j.id === job.id)!;
    assert.equal(found.appTitle, app.title);
    assert.equal(found.externalId, app.externalId);
    assert.equal(store.getJob(job.id)?.externalId, app.externalId);
    const discovery = store.enqueueJob({ type: 'discover', country: 'ph', store: 'google-play' });
    assert.equal(store.getJob(discovery.id)?.appTitle, null);
    store.run(
      "INSERT INTO monitor_cycles(id,due_at,started_at,status) VALUES (1,'2026-09-18T00:00:00Z','2026-09-18T00:02:00Z','completed-with-errors'),(2,'2026-09-20T00:00:00Z','2026-09-20T00:02:00Z','running')",
    );
    for (const id of [1, 2])
      store.run(
        "INSERT INTO monitor_tasks(cycle_id,task_key,kind,country,store,status,error,attempts,next_run_at,created_at,finished_at,payload) VALUES (?,'test','detail','ph','google-play','failed','test failure',3,?,?,?,'{}')",
        id,
        '2026-09-20T00:00:00Z',
        '2026-09-20T00:00:00Z',
        `2026-09-${id === 1 ? '18' : '20'}T00:03:00Z`,
      );
    const status = getCollectionStatus(store);
    assert.equal(status.activeCycle?.failed, 1);
    assert.equal(status.failures.length, 2);
    assert.equal(status.failureScope, 'recent-cross-cycle');
    assert.equal(status.failures[0].cycleId, 2);
    assert.equal(status.failures[1].failedAt, '2026-09-18T00:03:00Z');
    assert.equal(status.failures[1].cycleDueAt, '2026-09-18T00:00:00Z');
  } finally {
    store.close();
  }
});

test('#47 CSV is complete frozen snapshot with explicit three-way category and safe null/zero/text values', async () => {
  const store = createStore();
  const http = await serve(
    createApp({ store, password: 'test-password-long-enough', allowedOrigins: [] }),
  );
  try {
    const response = await fetch(`${http.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-password-long-enough' }),
    });
    const cookie = response.headers.getSetCookie()[0].split(';')[0];
    for (const [i, category] of ['personal', 'other', 'unknown'].entries()) {
      const app = store.createApp({
        store: 'app-store',
        country: 'ph',
        externalId: String(100 + i),
      });
      store.saveObservation(app.id, {
        ...creditApp,
        externalId: app.externalId,
        title: i === 0 ? '=formula' : 'Example',
        ratings: 0,
      });
      store.updateClassification(app.id, 'confirmed');
      if (category !== 'unknown')
        store.run(
          "INSERT INTO research_app_categories(app_id,category,reason,updated_by,updated_at) VALUES (?,?, 'fixture',0,'2026-09-20T00:00:00Z')",
          app.id,
          category,
        );
    }
    const base = '/api/market/apps?loanScope=all&limit=1';
    const frozen = await (await fetch(http.baseUrl + base, { headers: { cookie } })).json();
    store.run("UPDATE research_app_categories SET category='other' WHERE category='personal'");
    const csv = await (
      await fetch(`${http.baseUrl}/api/market/apps.csv?loanScope=all&snapshot=${frozen.snapshot}`, {
        headers: { cookie },
      })
    ).text();
    assert.match(csv, /loanCategory,loanCategoryLabel,loanCategorySource/);
    assert.match(csv, /"personal","个人现金贷","manual"/);
    assert.match(csv, /"other","其他已确认信贷","manual"/);
    assert.match(csv, /"unknown","待细分","unclassified"/);
    assert.match(csv, /"'=formula"/);
    assert.match(csv, /,"0","","","",/);
    assert.equal(csv.split('\r\n').filter(Boolean).length, 4);
    assert.ok(csv.includes(frozen.createdAt));
  } finally {
    await http.close();
    store.close();
  }
});

test('#46 later empty privacy observations do not erase earlier safe historical provenance', () => {
  const store = createStore();
  try {
    const app = store.createApp({
      country: 'pk',
      store: 'app-store',
      externalId: 'fixture.privacy',
    });
    const context = { source: 'store-privacy', requestCountry: 'pk', requestLanguage: 'en' };
    store.saveEnrichment(
      app.id,
      'privacy',
      {
        ...context,
        status: 'available',
        data: { privacyPolicyUrl: 'https://example.org/earlier' },
      },
      '2026-09-01T00:00:00Z',
    );
    store.saveEnrichment(
      app.id,
      'privacy',
      { ...context, status: 'empty', data: null },
      '2026-09-02T00:00:00Z',
    );
    store.saveEnrichment(
      app.id,
      'privacy',
      { ...context, status: 'available', data: { privacyPolicyUrl: 'javascript:alert(1)' } },
      '2026-09-03T00:00:00Z',
    );
    store.saveEnrichment(
      app.id,
      'privacy',
      {
        ...context,
        requestCountry: 'ph',
        status: 'available',
        data: { privacyPolicyUrl: 'https://example.org/wrong-market' },
      },
      '2026-09-04T00:00:00Z',
    );
    const before = JSON.stringify(store.listEnrichmentHistory(app.id, 'privacy'));
    const saved = store.historicalPrivacy(app.id)!;
    assert.equal(saved.url, 'https://example.org/earlier');
    assert.equal(saved.fetchedAt, '2026-09-01T00:00:00Z');
    assert.equal(saved.requestCountry, 'pk');
    assert.equal(saved.historyId, 1);
    assert.equal(JSON.stringify(store.listEnrichmentHistory(app.id, 'privacy')), before);
    assert.equal(store.getApp(app.id)?.privacyPolicy, null);
    assert.equal(store.historicalPrivacy(99999), null);
  } finally {
    store.close();
  }
});
