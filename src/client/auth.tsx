import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { SessionUser } from '../shared/types';
import { api } from './lib/api';

/** The phone number is remembered so a returning player only types a PIN. */
const LOGIN_KEY = 'jj.login';

export function rememberedLogin(): string {
  try {
    return localStorage.getItem(LOGIN_KEY) ?? '';
  } catch {
    return '';
  }
}

function storeLogin(login: string, remember: boolean) {
  try {
    if (remember) localStorage.setItem(LOGIN_KEY, login);
    else localStorage.removeItem(LOGIN_KEY);
  } catch {
    // Not remembering a login is survivable.
  }
}

interface AuthValue {
  user: SessionUser | null;
  /** True until the first /me probe settles, so routing does not flash. */
  loading: boolean;
  signIn: (login: string, pin: string, remember: boolean) => Promise<SessionUser>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<{ user: SessionUser | null }>('/api/auth/me');
      setUser(res.user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const signIn = useCallback(async (login: string, pin: string, remember: boolean) => {
    const res = await api.post<{ user: SessionUser }>('/api/auth/login', { login, pin });
    storeLogin(res.user.login, remember);
    setUser(res.user);
    return res.user;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, signIn, signOut, refresh }),
    [user, loading, signIn, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export const isStaff = (u: SessionUser | null) => u?.role === 'admin' || u?.role === 'coach';
export const isAdmin = (u: SessionUser | null) => u?.role === 'admin';
