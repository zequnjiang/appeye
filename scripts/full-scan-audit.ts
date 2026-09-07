import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Operational evidence only: opens the existing database read-only, never migrates or fetches.
const { values } = parseArgs({
  options: {
    database: { type: 'string', default: 'data/appeye.sqlite' },
    'batch-id': { type: 'string' },
    baseline: { type: 'string' },
    output: { type: 'string' },
    integrity: { type: 'boolean', default: false },
  },
});
if (!values['batch-id']) throw new Error('--batch-id is required');
const database = resolve(values.database!);
if (!existsSync(database)) throw new Error('Database does not exist');
if (values.output && resolve(values.output) === database)
  throw new Error('The audit output must not overwrite the database');
const db = new DatabaseSync(database, { readOnly: true });
const batchId = values['batch-id'];
const rows = (sql: string, ...params: SQLInputValue[]) =>
  db.prepare(sql).all(...params) as Record<string, any>[];
const one = (sql: string, ...params: SQLInputValue[]) => rows(sql, ...params)[0];
try {
  db.exec('BEGIN'); // One consistent read snapshot while the collector continues writing.
  const run = one('SELECT * FROM full_scan_runs WHERE id=?', batchId);
  if (!run) throw new Error('Batch not found');
  const baseline = values.baseline ? JSON.parse(readFileSync(values.baseline, 'utf8')) : null;
  if (baseline && baseline.batchId !== batchId) throw new Error('Baseline batch does not match');
  const baselineApps = baseline?.members ?? baseline?.apps ?? [];
  if (baseline && !Array.isArray(baseline.members ?? baseline.apps))
    throw new Error('Baseline must explicitly contain apps or members');
  if (
    !Array.isArray(baselineApps) ||
    baselineApps.some((app: any) => !Number.isSafeInteger(app.id) || app.id <= 0)
  )
    throw new Error('Baseline must contain positive member IDs');
  const targetApps = rows(
    `SELECT DISTINCT a.id,a.country,a.store,a.external_id,a.classification,a.classification_source,
      a.manual_override,a.first_seen_at FROM apps a JOIN full_scan_tasks t ON t.app_id=a.id
      WHERE t.batch_id=? AND t.kind='detail' ORDER BY a.id`,
    batchId,
  );
  const currentById = new Map(targetApps.map((app) => [app.id, app]));
  const baselineIds = new Set<number>(baselineApps.map((app: any) => app.id));
  if (baselineIds.size !== baselineApps.length)
    throw new Error('Baseline member IDs must be unique');
  // Other batch references and the independently frozen baseline detect a missing
  // detail task. Deriving expected membership only from detail tasks would make
  // that invariant tautological and silently lose an entirely omitted initial app.
  const expectedIds = [
    ...new Set<number>([
      ...baselineIds,
      ...rows(
        'SELECT app_id FROM full_scan_tasks WHERE batch_id=? AND app_id IS NOT NULL UNION SELECT app_id FROM full_scan_candidates WHERE batch_id=? AND app_id IS NOT NULL',
        batchId,
        batchId,
      ).map((row) => Number(row.app_id)),
    ]),
  ].sort((a, b) => a - b);
  const cohortJson = JSON.stringify(expectedIds);
  const mismatches: { id: number; fields: string[] }[] = [];
  for (const before of baselineApps) {
    const after = currentById.get(before.id);
    const fields = after
      ? Object.keys(before).filter((key) => after[key] !== before[key])
      : ['missing-from-batch-detail-targets'];
    if (fields.length) mismatches.push({ id: before.id, fields });
  }
  const report = {
    capturedAt: new Date().toISOString(),
    batchId,
    run: { ...run, config: JSON.parse(run.config) },
    cohort: {
      definition:
        'Existing detail targets, independent same-batch task/admission references, and supplied frozen baseline IDs; later hourly-only apps are excluded.',
      expectedMembers: expectedIds.length,
      detailTargets: targetApps.length,
      initialMembershipVerified: !!baseline,
      membersOutsideFrozenBaseline: baseline?.members
        ? expectedIds.filter((id) => !baselineIds.has(id))
        : null,
      missingAppRecords: expectedIds.filter((id) => !one('SELECT id FROM apps WHERE id=?', id))
        .length,
      limitation: baseline
        ? null
        : 'Without an independent initial member baseline, an app missing from every batch reference cannot be verified.',
    },
    baseline: baseline
      ? {
          capturedAt: baseline.capturedAt,
          appCount: baselineApps.length,
          preservationMismatches: mismatches,
          newMainAppCount: targetApps.filter((app) => !baselineIds.has(app.id)).length,
        }
      : null,
    totals: {
      allDatabaseMainApps: one('SELECT COUNT(*) n FROM apps').n,
      batchMainApps: targetApps.length,
      sourceRows: one('SELECT COUNT(*) n FROM full_scan_sources WHERE batch_id=?', batchId).n,
      uniqueDiscovered: one(
        'SELECT COUNT(*) n FROM (SELECT DISTINCT country,store,external_id FROM full_scan_sources WHERE batch_id=?)',
        batchId,
      ).n,
      allDatabaseReviewsRetained: one('SELECT COUNT(*) n FROM reviews').n,
      reviewsSeenThisBatch: one(
        'SELECT COUNT(*) n FROM full_scan_review_seen WHERE batch_id=?',
        batchId,
      ).n,
      allDatabaseSnapshotsRetained: one('SELECT COUNT(*) n FROM snapshots').n,
      httpResponses: one('SELECT COUNT(*) n FROM full_scan_http WHERE batch_id=?', batchId).n,
    },
    discovery: rows(
      `SELECT country,store,COUNT(*) rows,COUNT(DISTINCT external_id) uniqueApps,
       MIN(observed_at) firstObservedAt,MAX(observed_at) lastObservedAt
       FROM full_scan_sources WHERE batch_id=? GROUP BY country,store`,
      batchId,
    ),
    classifications: rows(
      `SELECT country,store,verdict,COUNT(*) count,SUM(app_id IS NOT NULL) inMainLibrary
       FROM full_scan_candidates WHERE batch_id=? GROUP BY country,store,verdict`,
      batchId,
    ),
    effectiveClassifications: rows(
      `SELECT country,store,classification,classification_source,COUNT(*) count FROM apps
       WHERE id IN (SELECT app_id FROM full_scan_tasks WHERE batch_id=? AND kind='detail')
       GROUP BY country,store,classification,classification_source`,
      batchId,
    ),
    tasks: rows(
      `SELECT country,store,kind,status,COUNT(*) count FROM full_scan_tasks
       WHERE batch_id=? GROUP BY country,store,kind,status`,
      batchId,
    ),
    supplementResults: rows(
      `SELECT country,store,json_extract(payload,'$.kind') supplementKind,status,
       json_extract(response,'$.status') sourceStatus,COUNT(*) count FROM full_scan_tasks
       WHERE batch_id=? AND kind='enrich' GROUP BY country,store,supplementKind,status,sourceStatus`,
      batchId,
    ),
    endReasons: rows(
      `SELECT country,store,kind,stop_reason reason,COUNT(*) count FROM full_scan_tasks
       WHERE batch_id=? AND stop_reason IS NOT NULL GROUP BY country,store,kind,stop_reason`,
      batchId,
    ),
    reviewStreams: rows(
      `SELECT t.country,t.store,t.status,t.stop_reason reason,COUNT(*) apps,MIN(t.page) minLastPage,
       MAX(t.page) maxLastPage FROM full_scan_tasks t WHERE t.batch_id=? AND t.kind='reviews'
       AND t.page=(SELECT MAX(x.page) FROM full_scan_tasks x WHERE x.batch_id=t.batch_id
       AND x.kind='reviews' AND x.app_id=t.app_id) GROUP BY t.country,t.store,t.status,t.stop_reason`,
      batchId,
    ),
    reviewWrites: rows(
      `SELECT country,store,SUM(json_extract(result,'$.fetched')) fetchedRows,
       SUM(json_extract(result,'$.added')) addedWrites,SUM(json_extract(result,'$.updated')) updatedWrites
       FROM full_scan_tasks WHERE batch_id=? AND kind='reviews' AND status='succeeded' GROUP BY country,store`,
      batchId,
    ),
    http: rows(
      `SELECT status,COUNT(*) count,SUM(length(body)) storedBodyCharacters,
       SUM(body IS NULL) missingBody FROM full_scan_http WHERE batch_id=? GROUP BY status`,
      batchId,
    ),
    attempts: rows(
      `SELECT t.kind,a.status,COUNT(*) count FROM full_scan_attempts a JOIN full_scan_tasks t ON t.id=a.task_id
       WHERE t.batch_id=? GROUP BY t.kind,a.status`,
      batchId,
    ),
    invariants: {
      missingDetailTasks: one(
        "SELECT COUNT(*) n FROM json_each(?) member WHERE NOT EXISTS (SELECT 1 FROM full_scan_tasks t WHERE t.batch_id=? AND t.app_id=member.value AND t.kind='detail')",
        cohortJson,
        batchId,
      ).n,
      mainAppsWithoutSevenSupplements: one(
        `SELECT COUNT(*) n FROM json_each(?) member WHERE (SELECT COUNT(DISTINCT json_extract(t.payload,'$.kind'))
         FROM full_scan_tasks t WHERE t.batch_id=? AND t.app_id=member.value AND t.kind='enrich')<>7`,
        cohortJson,
        batchId,
      ).n,
      mainAppsWithoutReviewStream: one(
        "SELECT COUNT(*) n FROM json_each(?) member WHERE NOT EXISTS (SELECT 1 FROM full_scan_tasks t WHERE t.batch_id=? AND t.app_id=member.value AND t.kind='reviews')",
        cohortJson,
        batchId,
      ).n,
      invalidSourceJson: one(
        'SELECT COUNT(*) n FROM full_scan_sources WHERE batch_id=? AND (NOT json_valid(raw) OR NOT json_valid(data))',
        batchId,
      ).n,
      sourceContextMismatch: one(
        `SELECT COUNT(*) n FROM full_scan_sources s JOIN full_scan_tasks t ON t.id=s.task_id
         WHERE s.batch_id=? AND (s.observed_at<>t.response_at OR s.country<>t.country OR s.store<>t.store)`,
        batchId,
      ).n,
      sourceMissingDiscoveryRecord: one(
        `SELECT COUNT(*) n FROM full_scan_sources s LEFT JOIN discovery_observations d ON d.id=s.discovery_id
         WHERE s.batch_id=? AND s.app_id IS NOT NULL AND (d.id IS NULL OR d.app_id<>s.app_id)`,
        batchId,
      ).n,
      responseMissingForSuccessfulTask: one(
        "SELECT COUNT(*) n FROM full_scan_tasks WHERE batch_id=? AND status='succeeded' AND (response IS NULL OR response_at IS NULL)",
        batchId,
      ).n,
      allDatabaseDuplicateReviewIdentities: one(
        'SELECT COUNT(*) n FROM (SELECT app_id,external_id FROM reviews GROUP BY app_id,external_id HAVING COUNT(*)>1)',
      ).n,
    },
    integrity: values.integrity
      ? {
          quickCheck: rows('PRAGMA quick_check'),
          foreignKeyViolations: rows('PRAGMA foreign_key_check'),
        }
      : { checked: false },
    note: 'A progress audit is not acceptance. Queued/running/deferred work, unresolved failures and continuation warnings require review before completion. Review write counts include updates; they are not all new unique reviews.',
  };
  db.exec('COMMIT');
  const output = JSON.stringify(report, null, 2) + '\n';
  if (values.output) writeFileSync(values.output, output);
  else process.stdout.write(output);
} finally {
  db.close();
}
