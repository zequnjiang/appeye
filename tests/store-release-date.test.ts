import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStoreReleaseDate } from '../server/store-release-date.js';

test('Play calendar dates from all six monitored markets retain their actual calendar day', () => {
  for (const [raw, expected] of [
    ['28 มี.ค. 2563', '2020-03-28'],
    ['26 พ.ย. 2562', '2019-11-26'],
    ['30 เม.ย. 2563', '2020-04-30'],
    ['8 nov 2017', '2017-11-08'],
    ['6 jun 2018', '2018-06-06'],
    ['May 7, 2018', '2018-05-07'],
    ['Sep 17, 2025', '2025-09-17'],
    ['3 Agu 2018', '2018-08-03'],
    ['7 Des 2015', '2015-12-07'],
    ['15 jul 2026', '2026-07-15'],
    ['7 dic 2025', '2025-12-07'],
    ['2026-09-07', '2026-09-07'],
  ])
    assert.equal(parseStoreReleaseDate(raw), expected, raw);
});

test('calendar validation rejects impossible or ambiguous dates instead of rolling into another day', () => {
  for (const raw of [
    'Feb 30, 2026',
    '31 abr 2026',
    '29 Feb 2025',
    '29 ก.พ. 2568',
    '2026-02-29',
    '2026-13-07',
    '09/07/2026',
    '7 Unknown 2026',
    '2026-09-07T01:00:00Z',
    '7 Sep',
    '',
    null,
    1757203200000,
  ])
    assert.equal(parseStoreReleaseDate(raw), null, String(raw));
  assert.equal(parseStoreReleaseDate('29 Feb 2024'), '2024-02-29');
  assert.equal(parseStoreReleaseDate('29 ก.พ. 2567'), '2024-02-29');
});

test('full month names, spelling variants and Thai digits remain dates across host timezones', () => {
  const originalTZ = process.env.TZ;
  try {
    for (const zone of ['UTC', 'Asia/Shanghai', 'America/Mexico_City']) {
      process.env.TZ = zone;
      for (const [raw, expected] of [
        ['7 septiembre 2026', '2026-09-07'],
        ['7 September 2026', '2026-09-07'],
        ['7 Oktober 2026', '2026-10-07'],
        ['7 ธันวาคม 2569', '2026-12-07'],
        ['๗ ก.ย. ๒๕๖๙', '2026-09-07'],
        ['7 Sept. 2026', '2026-09-07'],
      ])
        assert.equal(parseStoreReleaseDate(raw), expected, `${zone}: ${raw}`);
    }
  } finally {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  }
});
