import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

/** CLI and server share this ownership file; never remove an unverified live owner's lock. */
export function acquireCollectorLock(databasePath: string, label = 'coordinator') {
  const input = resolve(databasePath);
  mkdirSync(dirname(input), { recursive: true });
  const canonical = existsSync(input)
    ? realpathSync(input)
    : resolve(realpathSync(dirname(input)), basename(input));
  const path = `${canonical}.full-scan.lock`;
  // SQLite's OS lock is atomic across processes and released on process death.
  // Keep it on a separate tiny file so it never locks the application database.
  const ownership = new DatabaseSync(`${path}.sqlite`);
  try {
    ownership.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;');
  } catch {
    ownership.close();
    throw new Error(`Collector already owns ${path}`);
  }
  try {
    if (existsSync(path)) {
      const before = readFileSync(path, 'utf8');
      let old: { pid?: unknown };
      try {
        old = JSON.parse(before);
      } catch {
        throw new Error(`Malformed collector lock: ${path}`);
      }
      if (!Number.isInteger(old.pid) || Number(old.pid) <= 0)
        throw new Error(`Invalid collector PID: ${path}`);
      try {
        process.kill(Number(old.pid), 0);
        throw new Error(`Collector ${old.pid} already owns ${path}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
      if (readFileSync(path, 'utf8') !== before)
        throw new Error('Collector ownership changed during stale-lock check');
      unlinkSync(path);
    }
    const owner = JSON.stringify({
      pid: process.pid,
      label,
      nonce: randomUUID(),
      startedAt: new Date().toISOString(),
    });
    const fd = openSync(path, 'wx', 0o600);
    try {
      writeFileSync(fd, owner);
    } finally {
      closeSync(fd);
    }
    let released = false;
    return {
      path,
      release() {
        if (released) return;
        try {
          if (existsSync(path) && readFileSync(path, 'utf8') === owner) unlinkSync(path);
        } finally {
          released = true;
          ownership.exec('ROLLBACK');
          ownership.close();
        }
      },
    };
  } catch (error) {
    ownership.exec('ROLLBACK');
    ownership.close();
    throw error;
  }
}
