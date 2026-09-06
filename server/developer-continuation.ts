/**
 * Google uses two qnKhOb envelopes for developer directories. The installed SDK's
 * developer reader knows the legacy container at [0][6], while current responses
 * can use the same compact [0][0] container as its search reader.
 *
 * Keep the actual HTTP body untouched in the journal. This function only creates
 * a checked, in-memory input for the SDK's existing item parser.
 */
export interface DeveloperContinuationAdaptation {
  kind: 'developer-compact-continuation';
  apps: number;
  fromPath: '0.0';
  toPath: '0.6';
}

function at(value: unknown, path: number[]): unknown {
  let item = value;
  for (const index of path) {
    if (!Array.isArray(item)) return undefined;
    item = item[index];
  }
  return item;
}
function requiredString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function validItem(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const id = at(value, [12, 0]);
  const path = at(value, [9, 4, 2]);
  if (!requiredString(id) || !requiredString(path)) return false;
  try {
    const url = new URL(path, 'https://play.google.com');
    if (
      url.origin !== 'https://play.google.com' ||
      url.pathname !== '/store/apps/details' ||
      url.searchParams.get('id') !== id
    )
      return false;
  } catch {
    return false;
  }
  return (
    requiredString(value[2]) &&
    requiredString(at(value, [1, 1, 0, 3, 2])) &&
    requiredString(at(value, [4, 0, 0, 0]))
  );
}

export function normalizeDeveloperContinuation(body: string): {
  body: string;
  adaptation?: DeveloperContinuationAdaptation;
} {
  const start = body.indexOf('[');
  if (start < 0) return { body };
  const remainder = body.slice(start);
  const candidates = [...remainder.split('\n'), remainder];
  for (const candidate of candidates) {
    let frames: unknown;
    try {
      frames = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!Array.isArray(frames)) continue;
    const frame = frames.find(
      (value) => Array.isArray(value) && value[0] === 'wrb.fr' && value[1] === 'qnKhOb',
    );
    if (!Array.isArray(frame) || typeof frame[2] !== 'string') continue;
    let payload: unknown;
    try {
      payload = JSON.parse(frame[2]);
    } catch {
      return { body };
    }
    const root = at(payload, [0]);
    if (!Array.isArray(root)) return { body };
    // A present legacy container stays the SDK's responsibility, including parse failures.
    if (root[6] !== undefined && root[6] !== null) return { body };
    const compact = root[0];
    if (!Array.isArray(compact) || !Array.isArray(compact[0]) || !compact[0].every(validItem))
      return { body };
    const tokenContainer = compact[7];
    if (tokenContainer !== undefined && !Array.isArray(tokenContainer)) return { body };
    const token = tokenContainer?.[1];
    if (token !== undefined && token !== null && typeof token !== 'string') return { body };
    // The SDK treats an empty cluster page as terminal; do not turn a live continuation into false completion.
    if (compact[0].length === 0 && typeof token === 'string' && token.length > 0) return { body };
    root[6] = structuredClone(compact);
    frame[2] = JSON.stringify(payload);
    return {
      body: JSON.stringify(frames),
      adaptation: {
        kind: 'developer-compact-continuation',
        apps: compact[0].length,
        fromPath: '0.0',
        toPath: '0.6',
      },
    };
  }
  return { body };
}
