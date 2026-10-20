export class ApiError extends Error {
  constructor(public status: number, message: string, public fields: Record<string, string> = {}) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function handle(res: Response) {
  if (res.status === 401 && onUnauthorized && !res.url.includes('/api/auth/login')) onUnauthorized();
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('application/json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`, body?.details?.fields ?? {});
  return body;
}

const base = { credentials: 'same-origin' as const, headers: { 'X-Requested-With': 'XMLHttpRequest' } };

export const api = {
  get: <T = any>(url: string): Promise<T> => fetch(url, base).then(handle),
  post: <T = any>(url: string, body?: unknown): Promise<T> =>
    fetch(url, { ...base, method: 'POST', headers: { ...base.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then(handle),
  put: <T = any>(url: string, body?: unknown): Promise<T> =>
    fetch(url, { ...base, method: 'PUT', headers: { ...base.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then(handle),
  patch: <T = any>(url: string, body?: unknown): Promise<T> =>
    fetch(url, { ...base, method: 'PATCH', headers: { ...base.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then(handle),
  del: <T = any>(url: string): Promise<T> => fetch(url, { ...base, method: 'DELETE' }).then(handle),
  upload: <T = any>(url: string, form: FormData): Promise<T> => fetch(url, { ...base, method: 'POST', body: form }).then(handle),
};

/** Builds a query string, skipping empty values. */
export function qs(params: Record<string, any>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Downloads a server-generated export (PDF/XLSX/CSV) using the session cookie. */
export async function download(url: string) {
  const res = await fetch(url, base);
  if (!res.ok) {
    const b = await res.json().catch(() => null);
    throw new ApiError(res.status, b?.error ?? 'Export failed');
  }
  const cd = res.headers.get('content-disposition') ?? '';
  const name = decodeURIComponent(/filename="?([^"]+)"?/.exec(cd)?.[1] ?? 'download');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const fileUrl = (id: string, download = false) => `/api/files/${id}${download ? '?download=1' : ''}`;
