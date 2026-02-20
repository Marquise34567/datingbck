export function apiUrl(path: string) {
  const API_BASE = import.meta.env.VITE_API_BASE ?? "";
  const base = API_BASE ? API_BASE.replace(/\/$/, '') : '';
  if (!base) return path.startsWith('/') ? `/api${path}` : `/api/${path}`;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}/api${p}`;
}

export function apiFetch(path: string, opts?: RequestInit) {
  const url = apiUrl(path);
  const init = { credentials: 'include', ...opts } as RequestInit;
  return fetch(url, init);
}
