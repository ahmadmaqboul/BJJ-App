import type { SessionUser } from '../shared/types';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_TIMEZONE: string;
  DEFAULT_CURRENCY: string;
  /** Optional override; see auth.ts for why the default is low. */
  PIN_ITERATIONS?: string;
  /** `wrangler secret put SESSION_SECRET` — reserved for signed payloads. */
  SESSION_SECRET?: string;
  /** Set once the Telegram notification bot is wired up (phase 5). */
  TELEGRAM_BOT_TOKEN?: string;
}

export interface AppBindings {
  Bindings: Env;
  Variables: {
    user: SessionUser;
    /** Gym-local calendar day, resolved once per request. */
    today: string;
  };
}
