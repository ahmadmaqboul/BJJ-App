import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { today } from '@shared/dates';
import type { AppBindings, Env } from './env';
import { requireAuth, withToday } from './middleware';
import authRoutes from './routes/auth';
import memberRoutes from './routes/members';
import sessionRoutes from './routes/sessions';
import billingRoutes from './routes/billing';
import promotionRoutes from './routes/promotions';
import meRoutes from './routes/me';
import adminRoutes from './routes/admin';
import { runNightlyMaintenance } from './cron';

const app = new Hono<AppBindings>();

app.use('/api/*', withToday);

// Everything under /api needs a session except logging in and the probe used
// by the login screen to decide whether to redirect.
app.route('/api/auth', authRoutes);

app.use('/api/members/*', requireAuth);
app.use('/api/sessions/*', requireAuth);
app.use('/api/billing/*', requireAuth);
app.use('/api/promotions/*', requireAuth);
app.use('/api/me/*', requireAuth);
app.use('/api/admin/*', requireAuth);

app.route('/api/members', memberRoutes);
app.route('/api/sessions', sessionRoutes);
app.route('/api/billing', billingRoutes);
app.route('/api/promotions', promotionRoutes);
app.route('/api/me', meRoutes);
app.route('/api/admin', adminRoutes);

app.get('/api/health', (c) =>
  c.json({ ok: true, today: today(c.env.APP_TIMEZONE || 'Asia/Hebron') }),
);

app.notFound(async (c) => {
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: 'not_found' }, 404);
  }
  // Single-page app: any non-asset, non-API path renders the client, which
  // then routes internally.
  return serveIndex(c.env, c.req.url);
});

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    const body: Record<string, unknown> = { error: err.message };
    // Eligibility details ride along so the UI can offer "award anyway".
    if (err.cause) body.details = err.cause;
    return c.json(body, err.status);
  }
  console.error('unhandled', err);
  return c.json({ error: 'internal_error' }, 500);
});

async function serveIndex(env: Env, url: string): Promise<Response> {
  const indexUrl = new URL(url);
  indexUrl.pathname = '/index.html';
  indexUrl.search = '';
  const res = await env.ASSETS.fetch(new Request(indexUrl.toString()));
  if (res.status === 404) {
    return new Response(
      'Client assets are missing. Run `npm run build` before `wrangler deploy`.',
      { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }
  // Never let the HTML shell be cached; the hashed assets it points at are.
  const headers = new Headers(res.headers);
  headers.set('cache-control', 'no-cache');
  return new Response(res.body, { status: res.status, headers });
}

export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runNightlyMaintenance(env));
  },
} satisfies ExportedHandler<Env>;
