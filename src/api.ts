export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  options.signal?.throwIfAborted();
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  options.signal?.throwIfAborted();
  let body: any;
  try {
    body = await res.json();
  } catch (error) {
    options.signal?.throwIfAborted();
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError('服务器返回了无法识别的数据', res.status);
  }
  options.signal?.throwIfAborted();
  if (!res.ok) {
    const message =
      typeof body?.error === 'string'
        ? body.error
        : body?.error?.message || body?.message || `请求失败 (${res.status})`;
    if (res.status === 401) window.dispatchEvent(new Event('appeye:unauthorized'));
    throw new ApiError(message, res.status, typeof body?.code === 'string' ? body.code : undefined);
  }
  return body as T;
}
export const post = <T>(path: string, body: unknown = {}) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export function query(values: Record<string, string | number | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(values)) if (v !== undefined && v !== '') p.set(k, String(v));
  return `?${p}`;
}
export const put = <T>(path: string, body: unknown = {}) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const remove = <T>(path: string, body?: unknown) =>
  api<T>(path, {
    method: 'DELETE',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
export async function apiText(path: string, options: RequestInit = {}): Promise<string> {
  options.signal?.throwIfAborted();
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', ...options });
  const text = await response.text();
  options.signal?.throwIfAborted();
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('appeye:unauthorized'));
    let message = `请求失败 (${response.status})`;
    let code: string | undefined;
    try {
      const body = JSON.parse(text);
      message = body.error || message;
      code = typeof body.code === 'string' ? body.code : undefined;
    } catch {
      /* Non-JSON errors remain errors. */
    }
    throw new ApiError(message, response.status, code);
  }
  return text;
}
