export interface RelatedContinuationAdaptation {
  kind: 'related-null-token-container';
  apps: number;
  path: '0.0.7';
  originalValue: null;
  sdkValue: [null, null];
}

function at(value: unknown, path: number[]): unknown {
  let current = value;
  for (const index of path) {
    if (!Array.isArray(current)) return undefined;
    current = current[index];
  }
  return current;
}
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
function validItem(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const id = at(value, [12, 0]),
    path = at(value, [9, 4, 2]);
  if (
    !nonempty(id) ||
    !nonempty(path) ||
    !nonempty(value[2]) ||
    !nonempty(at(value, [1, 1, 0, 3, 2])) ||
    !nonempty(at(value, [4, 0, 0, 0]))
  )
    return false;
  try {
    const url = new URL(path, 'https://play.google.com');
    return (
      url.origin === 'https://play.google.com' &&
      url.pathname === '/store/apps/details' &&
      url.searchParams.getAll('id').length === 1 &&
      url.searchParams.get('id') === id
    );
  } catch {
    return false;
  }
}

/** Checked cluster items with an explicit null continuation container.
 * The caller journals original bytes before passing this in-memory copy to the SDK.
 */
export function normalizeRelatedContinuation(body: string): {
  body: string;
  adaptation?: RelatedContinuationAdaptation;
  warning?: { reason: 'related-source-error' | 'related-ambiguous-rpc'; sourceError?: unknown };
} {
  const start = body.indexOf('[');
  if (start < 0) return { body };
  const remainder = body.slice(start);
  let frames: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(remainder);
    if (Array.isArray(parsed)) frames = parsed;
  } catch {
    for (const line of remainder.split('\n')) {
      try {
        const parsed: unknown = JSON.parse(line);
        if (Array.isArray(parsed)) frames.push(...parsed);
      } catch {
        // The length prefix and unrelated malformed input stay the SDK's responsibility.
      }
    }
  }
  const matches = frames.filter(
    (frame) => Array.isArray(frame) && frame[0] === 'wrb.fr' && frame[1] === 'qnKhOb',
  ) as unknown[][];
  if (matches.length > 1) return { body, warning: { reason: 'related-ambiguous-rpc' } };
  const frame = matches[0];
  if (!frame) return { body };
  if (frame[5] !== undefined && frame[5] !== null)
    return { body, warning: { reason: 'related-source-error', sourceError: frame[5] } };
  if (typeof frame[2] !== 'string') return { body };
  let payload: unknown;
  try {
    payload = JSON.parse(frame[2]);
  } catch {
    return { body };
  }
  const root = at(payload, [0]);
  if (!Array.isArray(root) || (root[6] !== undefined && root[6] !== null)) return { body };
  const compact = root[0];
  if (!Array.isArray(compact) || !Array.isArray(compact[0]) || !compact[0].every(validItem))
    return { body };
  // SDK validates every intermediate tuple before reading its optional token field.
  // Google's explicit null container means no token; do not synthesize a cursor.
  if (compact[7] !== null) return { body };
  compact[7] = [null, null];
  frame[2] = JSON.stringify(payload);
  return {
    body: JSON.stringify(frames),
    adaptation: {
      kind: 'related-null-token-container',
      apps: compact[0].length,
      path: '0.0.7',
      originalValue: null,
      sdkValue: [null, null],
    },
  };
}
