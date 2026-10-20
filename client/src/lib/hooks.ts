import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { api } from './api';

/** Fetches JSON from url (re-runs when url changes). Pass null to skip. */
export function useApi<T = any>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(!!url);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!url) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await api.get<T>(url);
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e: any) {
      if (n === seq.current) setError(e);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

const cache = new Map<string, Promise<any>>();
/** Cached GET for reference data (districts, lookups, hostels…). */
export function useCached<T = any>(url: string) {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    if (!cache.has(url)) cache.set(url, api.get(url).catch((e) => { cache.delete(url); throw e; }));
    let live = true;
    cache.get(url)!.then((d) => live && setData(d)).catch(() => {});
    return () => {
      live = false;
    };
  }, [url]);
  return data;
}
export const clearCache = (prefix = '') => {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
};

export interface Lookup { id: string; group: string; value: string; label: string; meta?: any; isActive: boolean }
export function useLookups(group: string) {
  return useCached<Lookup[]>(`/api/admin/lookups?group=${group}`) ?? [];
}
export function useLookupLabel(group: string) {
  const l = useLookups(group);
  return (v?: string | null) => (v ? l.find((x) => x.value === v)?.label ?? v.replace(/_/g, ' ') : '—');
}
export function useDistricts() {
  return useCached<{ id: string; name: string; type: string }[]>('/api/admin/districts') ?? [];
}

/** Filter state stored in the URL query string (shareable, survives reloads). */
export function useQueryState<T extends Record<string, string>>(defaults: T) {
  const [sp, setSp] = useSearchParams();
  const state = { ...defaults } as T;
  for (const k of Object.keys(defaults)) {
    const v = sp.get(k);
    if (v !== null) (state as any)[k] = v;
  }
  const set = (patch: Partial<T>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === '' || v === undefined || v === (defaults as any)[k]) next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in patch)) next.delete('page');
    setSp(next, { replace: true });
  };
  return [state, set] as const;
}

export function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Scrolls to the element named by the URL hash once the page content is ready. */
export function useHashScroll(ready: boolean) {
  const { hash } = useLocation();
  useEffect(() => {
    if (ready && hash) setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }, [ready, hash]);
}
