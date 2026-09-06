export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const body = await res.json().catch(() => ({ error: '服务器返回了无法识别的数据' }));
  if (!res.ok) {
    const message =
      typeof body.error === 'string'
        ? body.error
        : body.error?.message || body.message || `请求失败 (${res.status})`;
    if (res.status === 401) window.dispatchEvent(new Event('appeye:unauthorized'));
    throw new ApiError(message, res.status);
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
