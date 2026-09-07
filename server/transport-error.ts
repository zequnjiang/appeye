const MESSAGE_LIMIT = 2000;
const CAUSE_MESSAGE_LIMIT = 1000;

function property(value: unknown, key: string): unknown {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null)
    return undefined;
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** Preserve the familiar message while retaining a bounded, explicit cause chain for diagnostics. */
export function describeTransportError(error: unknown): string {
  let message: string;
  try {
    message = error instanceof Error ? String(error.message) : String(error);
  } catch {
    message = 'Unknown transport error';
  }
  message = message.slice(0, MESSAGE_LIMIT);
  const causes: Array<{ name?: string; message?: string; code?: string | number }> = [];
  const seen = new Set<unknown>([error]);
  let cause = property(error, 'cause');
  for (let depth = 0; depth < 2 && cause != null && !seen.has(cause); depth++) {
    seen.add(cause);
    const entry: (typeof causes)[number] = {};
    const name = property(cause, 'name');
    const detail = property(cause, 'message');
    const code = property(cause, 'code');
    if (typeof name === 'string') entry.name = name.slice(0, 100);
    if (typeof detail === 'string') entry.message = detail.slice(0, CAUSE_MESSAGE_LIMIT);
    else if (['string', 'number', 'boolean', 'bigint'].includes(typeof cause))
      entry.message = String(cause).slice(0, CAUSE_MESSAGE_LIMIT);
    if (typeof code === 'string') entry.code = code.slice(0, 100);
    else if (typeof code === 'number' && Number.isFinite(code)) entry.code = code;
    if (Object.keys(entry).length) causes.push(entry);
    cause = property(cause, 'cause');
  }
  return causes.length ? `${message} | causes: ${JSON.stringify(causes)}` : message;
}
