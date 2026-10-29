import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { readStoredTheme, useApplyTheme, type Theme } from './lib/hooks';

/**
 * Theme state lives at the app root so the document stamp is applied on every
 * screen. Holding it inside the settings page meant the stamp vanished as soon
 * as the user navigated away, and a chosen dark theme reverted to light.
 */
interface ThemeValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  useApplyTheme(theme);

  const value = useMemo(() => ({ theme, setTheme }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
