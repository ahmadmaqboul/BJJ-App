import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

export interface AsyncState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  /** Re-fetches without clearing what is already on screen. */
  reload: () => void;
}

/**
 * Minimal data fetching: load on mount, reload on demand, and never apply a
 * response that arrived after the component moved on.
 */
export function useApi<T>(path: string | null, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(path !== null);
  const [nonce, setNonce] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (path === null) {
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    api
      .get<T>(path)
      .then((res) => {
        if (current && alive.current) {
          setData(res);
          setError(null);
        }
      })
      .catch((err) => {
        if (current && alive.current) setError(err);
      })
      .finally(() => {
        if (current && alive.current) setLoading(false);
      });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}

/** Tracks whether the browser thinks it has a connection. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

export type Theme = 'system' | 'light' | 'dark';
const THEME_KEY = 'jj.theme';

/**
 * Theme choice. `system` removes the stamp so the CSS media query decides;
 * light and dark stamp data-theme, which the stylesheet lets win over the OS.
 */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const v = localStorage.getItem(THEME_KEY);
      if (v === 'light' || v === 'dark' || v === 'system') return v;
    } catch {
      // Blocked storage just means the system preference applies.
    }
    return 'system';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Not persisting the theme is survivable.
    }
  }, [theme]);

  return [theme, setTheme];
}

/** Debounces a fast-changing value, for search boxes. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return out;
}
