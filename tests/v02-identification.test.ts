import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyLoan } from '../server/loan-identification.js';
import { strongLoanFixtures, facilitatorFixture, accessoryFixture, depositFixture, amountOnlyFixture } from './loan-fixtures.js';

test('V2-AC-03/06: six local-language loan offers require supporting evidence and preserve exact text spans', () => {
  for (const input of strongLoanFixtures) {
    const result = classifyLoan(input);
    assert.equal(result.verdict, 'strong', `${input.country}: ${result.summary}`);
    assert.equal(result.classification, 'confirmed', input.country);
    assert.ok(result.confidence >= 0 && result.confidence <= 100);
    assert.ok(result.ruleVersion);
    assert.ok(Number.isFinite(Date.parse(result.analyzedAt)));
    assert.ok(result.evidence.length >= 2, input.country);
    for (const evidence of result.evidence) {
      const source = input[evidence.source as 'title' | 'description'] ?? '';
      assert.ok(evidence.start >= 0 && evidence.end > evidence.start, evidence.id);
      assert.equal(source.slice(evidence.start, evidence.end), evidence.text, `${input.country}:${evidence.id}`);
    }
    assert.ok(result.sources.length > 0);
    assert.ok(result.sources.every(source => /^https:\/\//.test(source.url)));
  }
});

test('V2-AC-03/04: weak credit/category/name hints and missing descriptions never automatically confirm', () => {
  for (const input of [
    { title: 'Credit Points', description: 'Earn reward points and keep track of expenses.', genre: 'Finance' },
    { title: 'Example Financial Company', description: '', genre: 'Finance' },
    { title: 'Loan', description: '' },
    { title: 'Simple Wallet', description: 'Send money, pay bills, and manage your budget.' },
  ]) {
    const result = classifyLoan({ ...input, country: 'ph', store: 'google-play', externalId: 'fixture.weak' });
    assert.notEqual(result.verdict, 'strong', input.title);
    assert.equal(result.classification, 'candidate', input.title);
  }
});

test('V2-AC-04: a calculator with quoted APR/terms is insufficient, while explicit lender matchmaking can be strong', () => {
  const calculator = classifyLoan(accessoryFixture);
  assert.equal(calculator.verdict, 'insufficient');
  assert.equal(calculator.classification, 'candidate');
  const facilitator = classifyLoan(facilitatorFixture);
  assert.equal(facilitator.verdict, 'strong', facilitator.summary);
  assert.equal(facilitator.classification, 'confirmed');
});

test('V2-AC-04/06: deposit yields and standalone amounts do not become loan APR disclosures', () => {
  for (const input of [depositFixture, amountOnlyFixture]) {
    const result = classifyLoan(input);
    assert.notEqual(result.verdict, 'strong', input.title);
    assert.equal(result.classification, 'candidate');
    assert.ok(!result.disclosures.some(item => item.observedFields.includes('maximumApr')), input.title);
  }
});

test('V2-AC-06/08: maximum ordinary annual interest is distinct from APR; Thai 15% branch needs explicit annual maximum', () => {
  const input = {
    title: 'Example Personal Loan', externalId: 'fixture.th.rate', store: 'google-play' as const, country: 'th',
    description: 'Apply for a personal loan of 1000 to 10000 baht. Repayment term: 3 to 12 months. Maximum annual interest rate: 14%. Processing fee: 100 baht.',
  };
  const ordinary = classifyLoan(input);
  assert.ok(ordinary.disclosures.some(item => item.observedFields.includes('maximumInterestRate')));
  assert.ok(!ordinary.disclosures.some(item => item.observedFields.includes('maximumApr')));
  assert.equal(ordinary.disclosures.find(item => item.ruleId === 'GP-TH-UNREGULATED')?.status, 'not_observed');
  const apr = classifyLoan({ ...input, description: input.description + ' Maximum annual percentage rate (APR): 18%.' });
  assert.ok(apr.disclosures.some(item => item.observedFields.includes('maximumApr')));
  const unknownPeriod = classifyLoan({ ...input, description: 'Apply for a personal loan of 1000 to 10000 baht. Repayment term: 3 to 12 months. Interest rate: 14%. Fee: 100 baht.' });
  assert.equal(unknownPeriod.disclosures.find(item => item.ruleId === 'GP-TH-UNREGULATED')?.status, 'conditional');
});

test('V2-AC-07/08: Google Play country disclosure rules never become Apple admission or another country requirements', () => {
  const th = strongLoanFixtures.find(item => item.country === 'th')!;
  const apple = classifyLoan({ ...th, store: 'app-store', externalId: '123456' });
  assert.ok(apple.disclosures.some(item => item.ruleId.startsWith('GP-')));
  assert.ok(apple.disclosures.filter(item => item.ruleId.startsWith('GP-')).every(item => item.status === 'not_applicable'));
  for (const country of ['mx', 'ar', 'vn']) {
    const result = classifyLoan({ ...facilitatorFixture, country });
    assert.ok(result.disclosures.filter(item => /^GP-(TH|PH|ID|PK)-/.test(item.ruleId)).every(item => item.status === 'not_applicable'), country);
  }
});

test('V2-AC-08: EWA and revolving credit do not inherit personal-loan disclosure applicability', () => {
  for (const description of [
    'This is earned wage access (EWA), not a personal loan. Access your already earned wages before payday. Employer settlement occurs in 30 days. Service fee: 2%.',
    'Apply for a revolving credit card with a reusable credit limit of 10000. Maximum annual percentage rate (APR): 24%. Monthly payments apply; this is not an installment personal loan.',
  ]) {
    const result = classifyLoan({ ...facilitatorFixture, title: 'Example Credit Service', description });
    assert.ok(result.disclosures.filter(item => item.ruleId.startsWith('GP-PL-')).every(item => item.status === 'not_applicable'));
  }
});

test('V2-AC-06/10: company roles remain attributed claims and neither display names nor regulator names prove a lender', () => {
  const described = classifyLoan({
    ...facilitatorFixture,
    description: facilitatorFixture.description + ' Loan provider: Fictional Lender Corporation. Developer legal entity: Fictional Technology Limited. Business name: Fixture Cash. SEC registration: TEST-001. Certificate of Authority: TEST-002.',
  });
  assert.ok(described.entities.some(entity => entity.role === 'loanProvider' && entity.name.includes('Fictional Lender')));
  assert.ok(described.entities.some(entity => entity.role === 'developerLegalEntity' && entity.name.includes('Fictional Technology')));
  assert.ok(described.entities.every(entity => entity.verified === false));
  assert.ok(described.entities.every(entity => described.evidence.some(evidence => evidence.id === entity.evidenceId)));
  const ambiguous = classifyLoan({
    ...facilitatorFixture, description: 'A finance information app. Learn about OJK and SECP.',
    raw: { developer: 'Fictional Credit Display Brand', sellerName: 'Fictional Publishing Company' },
  });
  assert.ok(!ambiguous.entities.some(entity => entity.role === 'loanProvider' || entity.role === 'developerLegalEntity'));
  assert.ok(described.limitations.some(text => /牌照|许可|合规|license|compliance/i.test(text)));
});

test('V2-AC-03/07: caller-supplied observation time and stable rule provenance survive repeat analysis', () => {
  const input = { ...facilitatorFixture, observedAt: '2026-01-03T00:00:00.000Z' };
  const first = classifyLoan(input);
  const second = classifyLoan(input);
  assert.equal(first.ruleVersion, second.ruleVersion);
  assert.deepEqual(first.evidence, second.evidence);
  assert.deepEqual(first.disclosures, second.disclosures);
  assert.equal(first.country, 'ph');
  assert.equal(first.store, 'google-play');
  assert.equal(first.sourceObservedAt, input.observedAt);
  assert.notEqual(first.analyzedAt, input.observedAt);
  assert.equal(classifyLoan(facilitatorFixture).sourceObservedAt, null);
  assert.ok(first.disclosures.every(item => item.ruleId && item.sourceUrl && item.scope));
});

test('V2-AC-04/08: explicit denial and provider labels do not create a loan application intent', () => {
  const result = classifyLoan({ ...facilitatorFixture, description: 'Compare loans. We do not offer or arrange loans. Loan provider: Example Bank. Maximum APR 24%. Loan term 90 to 180 days.' });
  assert.notEqual(result.verdict, 'strong');
  assert.equal(result.classification, 'candidate');
});

test('V2-AC-06/08: a nearby service fee cannot replace the Thai maximum annual interest rate', () => {
  const result = classifyLoan({ ...facilitatorFixture, country: 'th', description: 'Apply for a personal loan. Maximum annual interest 20% and service fee 5%. Repayment term 90 to 180 days.' });
  const rate = result.evidence.filter(item => item.field === 'maximumInterestRate');
  assert.ok(rate.some(item => item.numericValue === 20));
  assert.ok(!rate.some(item => item.numericValue === 5));
  assert.equal(result.disclosures.find(item => item.ruleId === 'GP-TH-UNREGULATED')?.status, 'not_applicable');
});

test('V2-AC-08: EWA-specific disclosure context is applied only to earned wage access', () => {
  const ewa = classifyLoan({ ...facilitatorFixture, description: 'This is earned wage access (EWA), not a personal loan. Access your already earned wages before payday. Service fee: 2%.' });
  const personal = classifyLoan(facilitatorFixture);
  assert.notEqual(ewa.disclosures.find(item => item.ruleId === 'GP-EWA-DISCLOSURES')?.status, 'not_applicable');
  assert.equal(personal.disclosures.find(item => item.ruleId === 'GP-EWA-DISCLOSURES')?.status, 'not_applicable');
});
