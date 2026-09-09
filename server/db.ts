import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyLoan, type LoanAnalysis } from './loan-identification.js';
import { normalizeApp } from './normalization.js';
import type {
  AppFilters,
  AppRecord,
  Change,
  Classification,
  Country,
  Job,
  JobType,
  NormalizedApp,
  NormalizedReview,
  Review,
  Snapshot,
  StoreName,
  Enrichment,
  EnrichmentContext,
  EnrichmentHistory,
  EnrichmentKind,
  EnrichmentResult,
  DiscoveryObservation,
} from './types.js';

type Row = Record<string, any>;
const now = () => new Date().toISOString();
const parse = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : null);
const changedFields = [
  'version',
  'description',
  'title',
  'developer',
  'score',
  'ratings',
  'installs',
  'minInstalls',
  'maxInstalls',
  'reviewCount',
  'releaseNotes',
  'storeUpdatedAt',
] as const;
const nullableFields = [
  'developer',
  'icon',
  'url',
  'summary',
  'description',
  'version',
  'score',
  'ratings',
  'installs',
  'minInstalls',
  'maxInstalls',
  'releaseNotes',
  'releasedAt',
  'storeUpdatedAt',
  'genre',
  'bundleId',
  'reviewCount',
  'price',
  'currency',
  'developerWebsite',
  'privacyPolicy',
  'developerId',
  'developerUrl',
  'developerEmail',
  'developerAddress',
  'developerLegalName',
  'developerLegalEmail',
  'developerLegalAddress',
  'developerLegalPhoneNumber',
  'sellerName',
  'sellerUrl',
  'screenshots',
  'storeData',
] as const;
const defaultCountries = [
  { code: 'th', name: '泰国', language: 'th', keywords: ['สินเชื่อ', 'เงินกู้', 'loan'] },
  { code: 'mx', name: '墨西哥', language: 'es', keywords: ['préstamos', 'crédito', 'loan'] },
  { code: 'ph', name: '菲律宾', language: 'en', keywords: ['loan', 'utang', 'cash loan'] },
  { code: 'pk', name: '巴基斯坦', language: 'en', keywords: ['loan', 'قرض', 'cash loan'] },
  {
    code: 'id',
    name: '印度尼西亚',
    language: 'id',
    keywords: ['pinjaman', 'kredit', 'pinjaman online'],
  },
  { code: 'ar', name: '阿根廷', language: 'es', keywords: ['préstamos', 'crédito', 'dinero'] },
];

export function normalizeForStore(data: NormalizedApp, store: StoreName): NormalizedApp {
  const result: Record<string, unknown> = {
    ...data,
    externalId: String(data.externalId),
    title: data.title,
  };
  delete result.raw;
  for (const field of nullableFields) result[field] = data[field] ?? null;
  if (store === 'app-store') result.installs = result.minInstalls = result.maxInstalls = null;
  return result as unknown as NormalizedApp;
}

export class Store {
  readonly db: DatabaseSync;
  readonly path: string;
  constructor(path = ':memory:') {
    this.path = path;
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
    );
    // Migrations remain plain SQL and are copied beside compiled server code by the build script.
    const folder = resolve(dirname(fileURLToPath(import.meta.url)), 'migrations');
    for (const file of readdirSync(folder)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      if (this.one('SELECT version FROM schema_migrations WHERE version=?', file)) continue;
      this.transaction(() => {
        this.db.exec(readFileSync(resolve(folder, file), 'utf8'));
        this.run('INSERT INTO schema_migrations VALUES (?,?)', file, now());
      });
    }
    for (const c of defaultCountries)
      if (!this.getCountry(c.code)) this.upsertCountry({ ...c, enabled: true, intervalHours: 1 });
    this.backfillCurrentStoreData();
    this.backfillLoanAnalyses();
  }
  close() {
    this.db.close();
  }
  setDataset(dataset: 'live' | 'demo') {
    const current = this.one('SELECT value FROM metadata WHERE key=?', 'dataset');
    if (current && current.value !== dataset)
      throw new Error(`数据库数据集为 ${current.value}，拒绝以 ${dataset} 模式打开`);
    this.run('INSERT OR IGNORE INTO metadata(key,value) VALUES (?,?)', 'dataset', dataset);
  }
  one(sql: string, ...params: SQLInputValue[]): Row | undefined {
    return this.db.prepare(sql).get(...params) as Row | undefined;
  }
  all(sql: string, ...params: SQLInputValue[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }
  run(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).run(...params);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  listCountries(): Country[] {
    return this.all('SELECT * FROM countries ORDER BY created_at, code').map(this.countryRow);
  }
  getCountry(code: string): Country | undefined {
    const row = this.one('SELECT * FROM countries WHERE code=?', code);
    return row && this.countryRow(row);
  }
  private countryRow(row: Row): Country {
    return {
      code: row.code,
      name: row.name,
      language: row.language,
      keywords: parse(row.keywords),
      enabled: !!row.enabled,
      intervalHours: row.interval_hours,
      lastDiscoveryAt: row.last_discovery_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  upsertCountry(
    input: Pick<Country, 'code' | 'name' | 'language' | 'keywords' | 'enabled' | 'intervalHours'>,
  ): Country {
    const time = now();
    this.run(
      `INSERT INTO countries(code,name,language,keywords,enabled,interval_hours,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name,language=excluded.language,keywords=excluded.keywords,enabled=excluded.enabled,interval_hours=excluded.interval_hours,updated_at=excluded.updated_at`,
      input.code,
      input.name,
      input.language,
      JSON.stringify(input.keywords),
      Number(input.enabled),
      input.intervalHours,
      time,
      time,
    );
    return this.getCountry(input.code)!;
  }
  createApp(input: {
    store: StoreName;
    externalId: string;
    country: string;
    title?: string;
    sourceKeyword?: string;
    data?: NormalizedApp;
    observedAt?: string;
  }): AppRecord {
    const time = input.observedAt ?? now();
    const data = normalizeForStore(
      input.data ?? { externalId: input.externalId, title: input.title ?? input.externalId },
      input.store,
    );
    this.run(
      `INSERT INTO apps(store,external_id,country,title,developer,source_keyword,data,first_seen_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(store,external_id,country) DO UPDATE SET last_seen_at=excluded.last_seen_at`,
      input.store,
      input.externalId,
      input.country,
      data.title,
      data.developer ?? null,
      input.sourceKeyword ?? null,
      JSON.stringify(data),
      time,
      time,
    );
    const row = this.one(
      'SELECT * FROM apps WHERE store=? AND external_id=? AND country=?',
      input.store,
      input.externalId,
      input.country,
    )!;
    if (!row.loan_analysis) this.analyzeApp(row.id);
    return this.getApp(row.id)!;
  }
  getApp(id: number): AppRecord | undefined {
    const row = this.one('SELECT * FROM apps WHERE id=?', id);
    return row && this.appRow(row);
  }
  private appRow(row: Row): AppRecord {
    const observations = this.all(
      "SELECT json_extract(data,'$.version') version,observed_at FROM snapshots WHERE app_id=? AND json_extract(data,'$.version') IS NOT NULL ORDER BY observed_at,id",
      row.id,
    );
    const versions: Row[] = [];
    let previous: string | undefined;
    for (const observation of observations) {
      const version = String(observation.version).trim();
      if (!version || /^(vary|varies with device|unknown)$/i.test(version)) continue;
      if (previous !== undefined && version !== previous) versions.push(observation);
      previous = version;
    }
    const interval =
      versions.length >= 2
        ? (Date.parse(versions.at(-1)!.observed_at) - Date.parse(versions[0]!.observed_at)) /
          86400000 /
          (versions.length - 1)
        : null;
    return {
      ...parse(row.data),
      id: row.id,
      store: row.store,
      externalId: row.external_id,
      country: row.country,
      classification: row.classification,
      effectiveClassification: row.classification,
      classificationSource: row.classification_source,
      manualOverride: !!row.manual_override,
      loanAnalysis: parse(row.loan_analysis),
      sourceKeyword: row.source_keyword,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      lastFetchedAt: row.last_fetched_at,
      lastError: row.last_error,
      updateCount: versions.length,
      observedUpdateIntervalDays: interval,
    };
  }
  listApps(filters: AppFilters = {}): { apps: AppRecord[]; total: number } {
    const { clause, params } = this.appWhere(filters);
    const limit = Math.min(filters.limit ?? 100, 1000);
    const offset = filters.offset ?? 0;
    return {
      apps: this.all(
        `SELECT * FROM apps ${clause} ORDER BY first_seen_at DESC,id DESC LIMIT ? OFFSET ?`,
        ...params,
        limit,
        offset,
      ).map((r) => this.appRow(r)),
      total: this.one(`SELECT COUNT(*) AS n FROM apps ${clause}`, ...params)!.n,
    };
  }
  private appWhere(filters: AppFilters, prefix = ''): { clause: string; params: SQLInputValue[] } {
    const parts: string[] = [];
    const params: SQLInputValue[] = [];
    for (const key of ['country', 'store', 'classification'] as const)
      if (filters[key]) {
        parts.push(`${prefix}${key}=?`);
        params.push(filters[key]!);
      }
    if (filters.loanVerdict) {
      parts.push(`json_extract(${prefix}loan_analysis,'$.verdict')=?`);
      params.push(filters.loanVerdict);
    }
    if (filters.q) {
      parts.push(
        `(${prefix}title LIKE ? ESCAPE '\\' OR ${prefix}developer LIKE ? ESCAPE '\\' OR ${prefix}external_id LIKE ? ESCAPE '\\')`,
      );
      const q = `%${filters.q.replace(/[\\%_]/g, '\\$&')}%`;
      params.push(q, q, q);
    }
    return { clause: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
  }
  updateClassification(id: number, classification: Classification): AppRecord | undefined {
    this.run(
      "UPDATE apps SET classification=?,manual_override=1,classification_source='manual' WHERE id=?",
      classification,
      id,
    );
    return this.getApp(id);
  }
  setClassificationMode(id: number, mode: 'auto'): AppRecord | undefined {
    if (mode !== 'auto') throw new Error('Unsupported classification mode');
    const app = this.getApp(id);
    if (!app) return undefined;
    this.run("UPDATE apps SET manual_override=0,classification_source='auto' WHERE id=?", id);
    this.analyzeApp(id);
    return this.getApp(id);
  }
  saveLoanAnalysis(appId: number, analysis: LoanAnalysis): AppRecord | undefined {
    const config = this.one('SELECT * FROM research_rule_config WHERE id=1');
    if (config)
      analysis = {
        ...analysis,
        configurationVersion: config.version,
        autoConfirmStrong: !!config.auto_confirm_strong,
        classification:
          analysis.verdict === 'strong' && config.auto_confirm_strong ? 'confirmed' : 'candidate',
      };
    this.run(
      'UPDATE apps SET loan_analysis=?,classification=CASE WHEN manual_override=0 THEN ? ELSE classification END WHERE id=?',
      JSON.stringify(analysis),
      analysis.classification,
      appId,
    );
    return this.getApp(appId);
  }
  analyzeApp(appId: number, observedAt?: string): LoanAnalysis {
    const app = this.getApp(appId);
    if (!app) throw new Error('App not found');
    const analysis = classifyLoan({
      ...app,
      raw: this.getRawDetail(appId) ?? app.storeData,
      observedAt: observedAt ?? app.lastFetchedAt ?? app.firstSeenAt,
    });
    return this.saveLoanAnalysis(appId, analysis)!.loanAnalysis!;
  }
  backfillLoanAnalyses(force = false): number {
    const rows = this.all(`SELECT id FROM apps ${force ? '' : 'WHERE loan_analysis IS NULL'}`);
    for (const row of rows) this.analyzeApp(row.id);
    return rows.length;
  }
  getRawDetail(appId: number): unknown {
    return parse(
      this.one(
        'SELECT raw FROM snapshots WHERE app_id=? ORDER BY observed_at DESC,id DESC LIMIT 1',
        appId,
      )?.raw,
    );
  }
  backfillCurrentStoreData(): number {
    let count = 0;
    for (const row of this.all(
      "SELECT * FROM apps WHERE json_extract(data,'$.storeData') IS NULL",
    )) {
      const raw = this.getRawDetail(row.id);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const original = parse(row.data);
      const projected = normalizeApp(
        {
          ...raw,
          appId: row.store === 'google-play' ? row.external_id : (raw as Row).appId,
          id: row.store === 'app-store' ? row.external_id : (raw as Row).id,
          title: original.title,
        },
        row.store,
      );
      const merged = normalizeForStore(
        { ...projected, ...original, storeData: raw as Record<string, unknown> },
        row.store,
      );
      this.run('UPDATE apps SET data=? WHERE id=?', JSON.stringify(merged), row.id);
      count++;
    }
    return count;
  }
  recordDiscovery(
    appId: number,
    input: {
      keyword: string;
      requestCountry: string;
      requestLanguage: string;
      source: string;
      data: NormalizedApp;
      raw?: unknown;
      observedAt?: string;
    },
  ): DiscoveryObservation {
    if (!this.getApp(appId)) throw new Error('App not found');
    const observedAt = input.observedAt ?? now();
    const result = this.run(
      'INSERT INTO discovery_observations(app_id,observed_at,keyword,request_country,request_language,source,data,raw) VALUES (?,?,?,?,?,?,?,?)',
      appId,
      observedAt,
      input.keyword,
      input.requestCountry,
      input.requestLanguage,
      input.source,
      JSON.stringify(input.data),
      JSON.stringify(input.raw ?? input.data.raw ?? input.data),
    );
    return {
      id: Number(result.lastInsertRowid),
      appId,
      observedAt,
      keyword: input.keyword,
      requestCountry: input.requestCountry,
      requestLanguage: input.requestLanguage,
      source: input.source,
      data: input.data,
      raw: input.raw ?? input.data.raw ?? input.data,
    };
  }
  listDiscoveries(
    appId: number,
    limit = 100,
    offset = 0,
  ): { discoveries: DiscoveryObservation[]; total: number } {
    return {
      discoveries: this.all(
        'SELECT * FROM discovery_observations WHERE app_id=? ORDER BY id DESC LIMIT ? OFFSET ?',
        appId,
        limit,
        offset,
      ).map((r) => ({
        id: r.id,
        appId: r.app_id,
        observedAt: r.observed_at,
        keyword: r.keyword,
        requestCountry: r.request_country,
        requestLanguage: r.request_language,
        source: r.source,
        data: parse(r.data),
        raw: parse(r.raw),
      })),
      total: this.one('SELECT COUNT(*) n FROM discovery_observations WHERE app_id=?', appId)!.n,
    };
  }
  saveEnrichment(
    appId: number,
    kind: EnrichmentKind,
    result: EnrichmentResult,
    attemptedAt = now(),
    onSaved?: () => void,
  ): Enrichment {
    if (!this.getApp(appId)) throw new Error('App not found');
    const success = result.status === 'available' || result.status === 'empty';
    return this.transaction(() => {
      this.run(
        'INSERT INTO enrichment_history(app_id,kind,status,fetched_at,source,request_country,request_language,data,raw,error,note) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        appId,
        kind,
        result.status,
        attemptedAt,
        result.source,
        result.requestCountry,
        result.requestLanguage,
        success ? JSON.stringify(result.data ?? null) : null,
        success ? JSON.stringify(result.raw ?? result.data ?? null) : null,
        null,
        result.note ?? null,
      );
      this.run(
        `INSERT INTO enrichments(app_id,kind,status,last_attempt_at,last_success_at,source,request_country,request_language,attempt_source,attempt_request_country,attempt_request_language,data,raw,error,note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(app_id,kind) DO UPDATE SET status=excluded.status,last_attempt_at=excluded.last_attempt_at,last_success_at=CASE WHEN excluded.status IN ('available','empty') THEN excluded.last_success_at ELSE enrichments.last_success_at END,source=CASE WHEN excluded.status IN ('available','empty') THEN excluded.source ELSE enrichments.source END,request_country=CASE WHEN excluded.status IN ('available','empty') THEN excluded.request_country ELSE enrichments.request_country END,request_language=CASE WHEN excluded.status IN ('available','empty') THEN excluded.request_language ELSE enrichments.request_language END,attempt_source=excluded.attempt_source,attempt_request_country=excluded.attempt_request_country,attempt_request_language=excluded.attempt_request_language,data=CASE WHEN excluded.status IN ('available','empty') THEN excluded.data ELSE enrichments.data END,raw=CASE WHEN excluded.status IN ('available','empty') THEN excluded.raw ELSE enrichments.raw END,error=NULL,note=excluded.note`,
        appId,
        kind,
        result.status,
        attemptedAt,
        success ? attemptedAt : null,
        success ? result.source : null,
        success ? result.requestCountry : null,
        success ? result.requestLanguage : null,
        result.source,
        result.requestCountry,
        result.requestLanguage,
        success ? JSON.stringify(result.data ?? null) : null,
        success ? JSON.stringify(result.raw ?? result.data ?? null) : null,
        null,
        result.note ?? null,
      );
      // The batch ledger can mark this exact response applied in the same transaction.
      onSaved?.();
      return this.listEnrichments(appId).find((r) => r.kind === kind)!;
    });
  }
  failEnrichment(
    appId: number,
    kind: EnrichmentKind,
    error: string,
    context: EnrichmentContext,
    attemptedAt = now(),
  ): Enrichment {
    if (!this.getApp(appId)) throw new Error('App not found');
    return this.transaction(() => {
      this.run(
        'INSERT INTO enrichment_history(app_id,kind,status,fetched_at,source,request_country,request_language,data,raw,error,note) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        appId,
        kind,
        'failed',
        attemptedAt,
        context.source,
        context.requestCountry,
        context.requestLanguage,
        null,
        null,
        error,
        context.note ?? null,
      );
      this.run(
        `INSERT INTO enrichments(app_id,kind,status,last_attempt_at,attempt_source,attempt_request_country,attempt_request_language,error,note) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(app_id,kind) DO UPDATE SET status=excluded.status,last_attempt_at=excluded.last_attempt_at,attempt_source=excluded.attempt_source,attempt_request_country=excluded.attempt_request_country,attempt_request_language=excluded.attempt_request_language,error=excluded.error,note=excluded.note`,
        appId,
        kind,
        'failed',
        attemptedAt,
        context.source,
        context.requestCountry,
        context.requestLanguage,
        error,
        context.note ?? null,
      );
      return this.listEnrichments(appId).find((r) => r.kind === kind)!;
    });
  }
  listEnrichments(appId: number): Enrichment[] {
    return this.all('SELECT * FROM enrichments WHERE app_id=? ORDER BY kind', appId).map((r) => ({
      appId: r.app_id,
      kind: r.kind,
      status: r.status,
      fetchedAt: r.last_success_at,
      lastSuccessAt: r.last_success_at,
      lastAttemptAt: r.last_attempt_at,
      source: r.source ?? r.attempt_source,
      requestCountry: r.request_country,
      requestLanguage: r.request_language,
      attemptSource: r.attempt_source,
      attemptRequestCountry: r.attempt_request_country,
      attemptRequestLanguage: r.attempt_request_language,
      data: parse(r.data),
      raw: parse(r.raw),
      error: r.error,
      note: r.note,
    }));
  }
  listEnrichmentHistory(
    appId: number,
    kind: EnrichmentKind,
    limit = 100,
    offset = 0,
  ): { history: EnrichmentHistory[]; total: number } {
    return {
      history: this.all(
        'SELECT * FROM enrichment_history WHERE app_id=? AND kind=? ORDER BY id DESC LIMIT ? OFFSET ?',
        appId,
        kind,
        limit,
        offset,
      ).map((r) => ({
        id: r.id,
        appId: r.app_id,
        kind: r.kind,
        status: r.status,
        fetchedAt: r.fetched_at,
        source: r.source,
        requestCountry: r.request_country,
        requestLanguage: r.request_language,
        data: parse(r.data),
        raw: parse(r.raw),
        error: r.error,
        note: r.note,
      })),
      total: this.one(
        'SELECT COUNT(*) n FROM enrichment_history WHERE app_id=? AND kind=?',
        appId,
        kind,
      )!.n,
    };
  }
  setAppError(id: number, error: string | null) {
    this.run('UPDATE apps SET last_error=? WHERE id=?', error, id);
  }
  saveObservation(
    appId: number,
    data: NormalizedApp,
    observedAt = now(),
    onSaved?: (snapshotId: number) => void,
  ): Snapshot {
    const app = this.getApp(appId);
    if (!app) throw new Error('App not found');
    if (String(data.externalId) !== app.externalId)
      throw new Error('Provider returned a different externalId');
    const normalized = normalizeForStore(data, app.store);
    return this.transaction(() => {
      const previous = this.one(
        'SELECT data,observed_at FROM snapshots WHERE app_id=? ORDER BY observed_at DESC,id DESC LIMIT 1',
        appId,
      );
      const inserted = this.run(
        'INSERT INTO snapshots(app_id,observed_at,data,raw) VALUES (?,?,?,?)',
        appId,
        observedAt,
        JSON.stringify(normalized),
        JSON.stringify(data.raw ?? data),
      );
      const superseded = !!previous && previous.observed_at > observedAt;
      if (previous && !superseded) {
        const old = parse(previous.data);
        for (const field of changedFields)
          if (JSON.stringify(old[field] ?? null) !== JSON.stringify(normalized[field] ?? null))
            this.run(
              'INSERT INTO changes(app_id,field,old_value,new_value,observed_at,snapshot_id) VALUES (?,?,?,?,?,?)',
              appId,
              field,
              JSON.stringify(old[field] ?? null),
              JSON.stringify(normalized[field] ?? null),
              observedAt,
              Number(inserted.lastInsertRowid),
            );
      }

      if (!superseded) {
        this.run(
          'UPDATE apps SET title=?,developer=?,data=?,last_seen_at=?,last_fetched_at=?,last_error=NULL WHERE id=?',
          normalized.title,
          normalized.developer ?? null,
          JSON.stringify(normalized),
          observedAt,
          observedAt,
          appId,
        );
        this.analyzeApp(appId, observedAt);
      }
      onSaved?.(Number(inserted.lastInsertRowid));
      return {
        id: Number(inserted.lastInsertRowid),
        appId,
        observedAt,
        data: normalized,
        raw: data.raw ?? data,
      };
    });
  }
  listSnapshots(appId: number, limit = 100, offset = 0): { snapshots: Snapshot[]; total: number } {
    return {
      snapshots: this.all(
        'SELECT * FROM snapshots WHERE app_id=? ORDER BY observed_at DESC,id DESC LIMIT ? OFFSET ?',
        appId,
        limit,
        offset,
      ).map((r) => ({
        id: r.id,
        appId: r.app_id,
        observedAt: r.observed_at,
        data: parse(r.data),
        raw: parse(r.raw),
      })),
      total: this.one('SELECT COUNT(*) n FROM snapshots WHERE app_id=?', appId)!.n,
    };
  }
  listChanges(filters: AppFilters & { appId?: number; field?: string; since?: string } = {}): {
    changes: Change[];
    total: number;
  } {
    const { clause, params } = this.appWhere(filters, 'a.');
    const extra: string[] = [];
    if (filters.appId) {
      extra.push('c.app_id=?');
      params.push(filters.appId);
    }
    if (filters.field) {
      extra.push('c.field=?');
      params.push(filters.field);
    }
    if (filters.since) {
      extra.push('c.observed_at>=?');
      params.push(filters.since);
    }
    const where =
      clause + (extra.length ? `${clause ? ' AND ' : 'WHERE '}${extra.join(' AND ')}` : '');
    const from = `FROM changes c JOIN apps a ON a.id=c.app_id ${where}`;
    return {
      changes: this.all(
        `SELECT c.*,a.title,a.store,a.country ${from} ORDER BY c.observed_at DESC,c.id DESC LIMIT ? OFFSET ?`,
        ...params,
        filters.limit ?? 100,
        filters.offset ?? 0,
      ).map((r) => ({
        id: r.id,
        snapshotId: r.snapshot_id,
        appId: r.app_id,
        field: r.field,
        oldValue: parse(r.old_value),
        newValue: parse(r.new_value),
        observedAt: r.observed_at,
        title: r.title,
        store: r.store,
        country: r.country,
      })),
      total: this.one(`SELECT COUNT(*) n ${from}`, ...params)!.n,
    };
  }
  saveReviews(
    appId: number,
    reviews: NormalizedReview[],
    language?: string,
    fetchedAt = now(),
    onSaved?: () => void,
  ): number {
    const app = this.getApp(appId);
    if (!app) throw new Error('App not found');
    const country = this.getCountry(app.country)!;
    let inserted = 0;
    this.transaction(() => {
      for (const review of reviews) {
        const r = this.run(
          `INSERT INTO reviews(app_id,external_id,country,language,user_name,title,text,score,version,reviewed_at,reply_text,fetched_at,raw) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(app_id,external_id) DO UPDATE SET country=excluded.country,language=excluded.language,user_name=excluded.user_name,title=excluded.title,text=excluded.text,score=excluded.score,version=excluded.version,reviewed_at=excluded.reviewed_at,reply_text=excluded.reply_text,fetched_at=excluded.fetched_at,raw=excluded.raw WHERE excluded.fetched_at>=reviews.fetched_at`,
          appId,
          review.externalId,
          app.country,
          review.language ?? language ?? country.language,
          review.userName ?? null,
          review.title ?? null,
          review.text,
          review.score ?? null,
          review.version ?? null,
          review.reviewedAt ?? null,
          review.replyText ?? null,
          fetchedAt,
          JSON.stringify(review.raw ?? review),
        );
        inserted += Number(r.changes);
      }
      onSaved?.();
    });
    return inserted;
  }
  listReviews(
    appId: number,
    filters: {
      limit?: number;
      offset?: number;
      score?: number;
      language?: string;
      since?: string;
    } = {},
  ): { reviews: Review[]; total: number } {
    const parts = ['app_id=?'];
    const params: SQLInputValue[] = [appId];
    if (filters.score) {
      parts.push('score=?');
      params.push(filters.score);
    }
    if (filters.language) {
      parts.push('language=?');
      params.push(filters.language);
    }
    if (filters.since) {
      parts.push('reviewed_at>=?');
      params.push(filters.since);
    }
    const where = parts.join(' AND ');
    return {
      reviews: this.all(
        `SELECT * FROM reviews WHERE ${where} ORDER BY reviewed_at DESC,id DESC LIMIT ? OFFSET ?`,
        ...params,
        filters.limit ?? 100,
        filters.offset ?? 0,
      ).map((r) => ({
        id: r.id,
        appId: r.app_id,
        externalId: r.external_id,
        country: r.country,
        language: r.language,
        userName: r.user_name,
        title: r.title,
        text: r.text,
        score: r.score,
        version: r.version,
        reviewedAt: r.reviewed_at,
        replyText: r.reply_text,
        fetchedAt: r.fetched_at,
        raw: parse(r.raw),
      })),
      total: this.one(`SELECT COUNT(*) n FROM reviews WHERE ${where}`, ...params)!.n,
    };
  }
  enqueueJob(input: {
    type: JobType;
    country: string;
    store: StoreName;
    appId?: number | null;
    maxAttempts?: number;
    nextRunAt?: string;
  }): Job {
    const key = `${input.type}:${input.country}:${input.store}:${input.appId ?? ''}`;
    const time = now();
    this.run(
      `INSERT OR IGNORE INTO jobs(type,country,store,app_id,dedupe_key,max_attempts,created_at,next_run_at) VALUES (?,?,?,?,?,?,?,?)`,
      input.type,
      input.country,
      input.store,
      input.appId ?? null,
      key,
      input.maxAttempts ?? 3,
      time,
      input.nextRunAt ?? time,
    );
    return this.jobRow(
      this.one(
        "SELECT * FROM jobs WHERE dedupe_key=? AND status IN ('queued','running') ORDER BY id DESC LIMIT 1",
        key,
      )!,
    );
  }
  private jobRow(r: Row): Job {
    return {
      id: r.id,
      type: r.type,
      status: r.status,
      country: r.country,
      store: r.store,
      appId: r.app_id,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      progress: r.progress,
      result: parse(r.result),
      error: r.error,
      createdAt: r.created_at,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      nextRunAt: r.next_run_at,
    };
  }
  getJob(id: number): Job | undefined {
    const r = this.one('SELECT * FROM jobs WHERE id=?', id);
    return r && this.jobRow(r);
  }
  listJobs(
    filters: {
      status?: string;
      type?: string;
      country?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): { jobs: Job[]; total: number } {
    const parts: string[] = [];
    const params: SQLInputValue[] = [];
    for (const key of ['status', 'type', 'country'] as const)
      if (filters[key]) {
        parts.push(`${key}=?`);
        params.push(filters[key]!);
      }
    const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
    return {
      jobs: this.all(
        `SELECT * FROM jobs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
        ...params,
        filters.limit ?? 100,
        filters.offset ?? 0,
      ).map((r) => this.jobRow(r)),
      total: this.one(`SELECT COUNT(*) n FROM jobs ${where}`, ...params)!.n,
    };
  }
  claimJob(): Job | undefined {
    return this.transaction(() => {
      const r = this.one(
        "SELECT * FROM jobs WHERE status='queued' AND next_run_at<=? ORDER BY id LIMIT 1",
        now(),
      );
      if (!r) return undefined;
      this.run(
        "UPDATE jobs SET status='running',attempts=attempts+1,started_at=?,finished_at=NULL WHERE id=?",
        now(),
        r.id,
      );
      return this.getJob(r.id);
    });
  }
  updateJobProgress(id: number, progress: string) {
    this.run('UPDATE jobs SET progress=? WHERE id=?', progress, id);
  }
  completeJob(id: number, result: unknown) {
    this.run(
      "UPDATE jobs SET status='succeeded',result=?,error=NULL,finished_at=?,progress='完成' WHERE id=?",
      JSON.stringify(result),
      now(),
      id,
    );
  }
  failJob(id: number, error: string, retryDelayMs = 30000) {
    const job = this.getJob(id);
    if (!job) return;
    const retry = job.attempts < job.maxAttempts;
    this.run(
      'UPDATE jobs SET status=?,error=?,next_run_at=?,finished_at=? WHERE id=?',
      retry ? 'queued' : 'failed',
      error,
      new Date(Date.now() + retryDelayMs).toISOString(),
      retry ? null : now(),
      id,
    );
  }
  retryJob(id: number): Job | undefined {
    const job = this.getJob(id);
    if (!job) return undefined;
    if (job.status !== 'failed') throw new Error('Only failed jobs can be retried');
    this.run(
      "UPDATE jobs SET status='queued',attempts=0,error=NULL,finished_at=NULL,started_at=NULL,next_run_at=? WHERE id=?",
      now(),
      id,
    );
    return this.getJob(id);
  }
  recoverRunningJobs(): number {
    const a = this.run(
      "UPDATE jobs SET status='failed',finished_at=?,error='进程中断：已达到最大尝试次数' WHERE status='running' AND attempts>=max_attempts",
      now(),
    );
    const b = this.run(
      "UPDATE jobs SET status='queued',next_run_at=?,error='进程中断：任务已恢复等待重试' WHERE status='running'",
      now(),
    );
    return Number(a.changes) + Number(b.changes);
  }
  scheduleDueJobs(time = now()): number {
    let count = 0;
    this.transaction(() => {
      for (const country of this.listCountries().filter((c) => c.enabled))
        for (const store of ['google-play', 'app-store'] as StoreName[]) {
          const state = this.one(
            'SELECT last_scheduled_at FROM schedule_state WHERE country=? AND store=?',
            country.code,
            store,
          );
          if (
            state &&
            Date.parse(time) - Date.parse(state.last_scheduled_at) < country.intervalHours * 3600000
          )
            continue;
          this.enqueueJob({ type: 'discover', country: country.code, store });
          for (const app of this.all(
            "SELECT id FROM apps WHERE country=? AND store=? AND classification!='excluded'",
            country.code,
            store,
          ))
            this.enqueueJob({ type: 'refresh', country: country.code, store, appId: app.id });
          this.run(
            'INSERT INTO schedule_state VALUES (?,?,?) ON CONFLICT(country,store) DO UPDATE SET last_scheduled_at=excluded.last_scheduled_at',
            country.code,
            store,
            time,
          );
          count++;
        }
    });
    return count;
  }
  markDiscovered(country: string) {
    this.run('UPDATE countries SET last_discovery_at=? WHERE code=?', now(), country);
  }
  overview() {
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const stat = this.one(
      `SELECT COUNT(*) apps,SUM(classification='confirmed') confirmed,SUM(classification='candidate') candidates FROM apps`,
    )!;
    return {
      stats: {
        apps: stat.apps,
        newApps7d: this.one('SELECT COUNT(*) n FROM apps WHERE first_seen_at>=?', since)!.n,
        confirmed: stat.confirmed ?? 0,
        candidates: stat.candidates ?? 0,
        changes7d: this.one('SELECT COUNT(*) n FROM changes WHERE observed_at>=?', since)!.n,
        reviews: this.one('SELECT COUNT(*) n FROM reviews')!.n,
        jobsFailed: this.one("SELECT COUNT(*) n FROM jobs WHERE status='failed'")!.n,
      },
      countries: this.listCountries().map((c) => ({
        ...c,
        apps: this.one('SELECT COUNT(*) n FROM apps WHERE country=?', c.code)!.n,
        confirmed: this.one(
          "SELECT COUNT(*) n FROM apps WHERE country=? AND classification='confirmed'",
          c.code,
        )!.n,
        candidates: this.one(
          "SELECT COUNT(*) n FROM apps WHERE country=? AND classification='candidate'",
          c.code,
        )!.n,
        changes7d: this.one(
          'SELECT COUNT(*) n FROM changes JOIN apps ON apps.id=changes.app_id WHERE country=? AND observed_at>=?',
          c.code,
          since,
        )!.n,
      })),
      recentDiscoveries: this.listApps({ limit: 6 }).apps,
      recentChanges: this.listChanges({ limit: 12 }).changes,
      recentJobs: this.listJobs({ limit: 8 }).jobs,
    };
  }
}
export function createStore(path = ':memory:') {
  return new Store(path);
}
