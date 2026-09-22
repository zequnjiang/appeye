import type { Store } from './db.js';
import { classifyLoan, type LoanAnalysis } from './loan-identification.js';

/** Offline maintenance: repair saved evidence without reclassifying the library or fabricating observations. */
export function refreshLoanEvidence(store: Store) {
  const summary = {
    examined: 0,
    refreshed: 0,
    unchanged: 0,
    unavailableSourceIds: [] as number[],
    classificationPreserved: true,
    networkRequests: 0,
  };
  const config = store.one('SELECT * FROM research_rule_config WHERE id=1');
  return store.transaction(() => {
    for (const row of store.all(
      'SELECT id,country,store,external_id,title,data,loan_analysis,last_fetched_at,first_seen_at FROM apps WHERE loan_analysis IS NOT NULL ORDER BY id',
    )) {
      summary.examined++;
      const previous = JSON.parse(row.loan_analysis) as LoanAnalysis;
      let data = JSON.parse(row.data);
      const sourceTime = previous.sourceObservedAt;
      if (sourceTime != null && sourceTime !== (row.last_fetched_at ?? row.first_seen_at)) {
        const snapshot = store.one(
          'SELECT data FROM snapshots WHERE app_id=? AND observed_at=? ORDER BY id DESC LIMIT 1',
          row.id,
          sourceTime,
        );
        if (!snapshot) {
          summary.unavailableSourceIds.push(row.id);
          continue;
        }
        data = JSON.parse(snapshot.data);
      }
      const next = classifyLoan({
        ...data,
        title: data.title ?? row.title,
        country: row.country,
        store: row.store,
        externalId: row.external_id,
        observedAt: sourceTime ?? undefined,
      });
      if (previous.ruleVersion === next.ruleVersion) {
        summary.unchanged++;
        continue;
      }
      if (config) {
        next.configurationVersion = config.version;
        next.autoConfirmStrong = !!config.auto_confirm_strong;
        next.classification =
          next.verdict === 'strong' && config.auto_confirm_strong ? 'confirmed' : 'candidate';
      }
      const record = {
        issues: [32, 45],
        previous,
        next,
        classificationPreserved: true,
        mode: 'saved-evidence-only',
      };
      store.run(
        "INSERT INTO research_audit(actor_id,workspace_id,action,target_id,detail,created_at) VALUES (0,NULL,'maintenance.loan-evidence',?,?,?)",
        String(row.id),
        JSON.stringify(record),
        next.analyzedAt,
      );
      // Deliberately do not call saveLoanAnalysis: this maintenance fixes evidence,
      // while the existing automatic/manual classification workflow stays explicit.
      store.run('UPDATE apps SET loan_analysis=? WHERE id=?', JSON.stringify(next), row.id);
      summary.refreshed++;
    }
    return summary;
  });
}
