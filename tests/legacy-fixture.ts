import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export const legacyRaw = {
  appId: 'fixture.legacy.credit',
  title: 'Legacy Synthetic Credit',
  unknownFutureField: {
    nested: ['สินเชื่อ', 'crédito', { anotherUnknown: true }],
    emptyArray: [],
    nullValue: null,
  },
  descriptionHTML: '<p>Fixture loan terms</p><img src=x onerror="alert(1)">',
  sourceDisclaimer: 'Synthetic data only; never a real provider or legal company.',
};

export const legacyNormalized = {
  externalId: 'fixture.legacy.credit',
  title: 'Legacy Synthetic Credit',
  developer: 'Fixture Display Name',
  description: 'Personal loan application. Borrow 1000 to 5000 with a 12 month repayment term.',
  version: '1.1.0',
  score: 4.2,
  ratings: 100,
  installs: '10,000+',
  minInstalls: 10000,
  maxInstalls: 50000,
  releasedAt: '2025-01-01T00:00:00.000Z',
};

/** Creates a genuine V0.1-layout SQLite database containing only synthetic observations. */
export function seedLegacyDatabase(path: string) {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys=ON');
    db.exec(readFileSync(new URL('./fixtures/v01-schema.sql', import.meta.url), 'utf8'));
    db.prepare('INSERT INTO metadata(key,value) VALUES (?,?)').run('dataset', 'live');
    db.prepare('INSERT INTO countries VALUES (?,?,?,?,?,?,?,?,?)').run(
      'th',
      '泰国旧配置',
      'en',
      JSON.stringify(['fixture loan']),
      0,
      48,
      null,
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
    );
    for (const [id, classification] of [
      [7, 'confirmed'],
      [8, 'excluded'],
      [9, 'candidate'],
    ] as const) {
      const externalId =
        id === 7 ? legacyNormalized.externalId : `fixture.legacy.${classification}`;
      db.prepare(
        'INSERT INTO apps(id,store,external_id,country,classification,title,developer,source_keyword,data,first_seen_at,last_seen_at,last_fetched_at,last_error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ).run(
        id,
        'google-play',
        externalId,
        'th',
        classification,
        legacyNormalized.title,
        legacyNormalized.developer,
        'fixture loan',
        JSON.stringify({ ...legacyNormalized, externalId }),
        '2026-01-01T00:00:00.000Z',
        '2026-01-03T00:00:00.000Z',
        '2026-01-03T00:00:00.000Z',
        id === 8 ? 'Legacy failure must remain visible' : null,
      );
    }
    db.prepare('INSERT INTO snapshots(id,app_id,observed_at,data,raw) VALUES (?,?,?,?,?)').run(
      11,
      7,
      '2026-01-02T00:00:00.000Z',
      JSON.stringify({ ...legacyNormalized, version: '1.0.0' }),
      JSON.stringify({ ...legacyRaw, version: '1.0.0' }),
    );
    db.prepare('INSERT INTO snapshots(id,app_id,observed_at,data,raw) VALUES (?,?,?,?,?)').run(
      12,
      7,
      '2026-01-03T00:00:00.000Z',
      JSON.stringify(legacyNormalized),
      JSON.stringify(legacyRaw),
    );
    db.prepare(
      'INSERT INTO changes(id,app_id,field,old_value,new_value,observed_at,snapshot_id) VALUES (?,?,?,?,?,?,?)',
    ).run(21, 7, 'version', '"1.0.0"', '"1.1.0"', '2026-01-03T00:00:00.000Z', 12);
    db.prepare(
      'INSERT INTO reviews(id,app_id,external_id,country,language,user_name,title,text,score,version,reviewed_at,reply_text,fetched_at,raw) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      31,
      7,
      'legacy-review',
      'th',
      'en',
      'Synthetic Reviewer',
      'Fixture',
      'Preserved synthetic review',
      4,
      '1.1.0',
      '2026-01-03T00:00:00.000Z',
      null,
      '2026-01-03T01:00:00.000Z',
      JSON.stringify({ unknownReviewField: ['kept'] }),
    );
    db.prepare(
      'INSERT INTO jobs(id,type,status,country,store,app_id,dedupe_key,attempts,max_attempts,progress,result,error,created_at,started_at,finished_at,next_run_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      41,
      'refresh',
      'queued',
      'th',
      'google-play',
      7,
      'refresh:th:google-play:7',
      0,
      3,
      null,
      null,
      null,
      '2026-01-03T00:00:00.000Z',
      null,
      null,
      '2099-01-01T00:00:00.000Z',
    );
    db.prepare(
      'INSERT INTO jobs(id,type,status,country,store,app_id,dedupe_key,attempts,max_attempts,progress,result,error,created_at,started_at,finished_at,next_run_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      42,
      'reviews',
      'failed',
      'th',
      'google-play',
      7,
      'reviews:th:google-play:7',
      3,
      3,
      'Legacy progress',
      null,
      'Legacy upstream failure',
      '2026-01-03T00:00:00.000Z',
      '2026-01-03T01:00:00.000Z',
      '2026-01-03T02:00:00.000Z',
      '2026-01-03T01:00:00.000Z',
    );
    db.prepare('INSERT INTO schedule_state VALUES (?,?,?)').run(
      'th',
      'google-play',
      '2026-01-03T00:00:00.000Z',
    );
  } finally {
    db.close();
  }
}
