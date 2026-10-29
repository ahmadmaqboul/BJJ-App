# JUI-Jitsu — إدارة الفريق

Attendance, payments and promotions for the JUI-Jitsu team in Nablus.
Arabic-first, works on a phone, installable to the home screen, and runs
entirely on free tiers.

- **Frontend** React + Vite + Tailwind, RTL by default, English available
- **API** Hono on a Cloudflare Worker
- **Database** Cloudflare D1 (SQLite)
- **Cost** £0 / $0 — see [Hosting](#hosting) for the actual limits

---

## What it does

**Attendance.** Open a class, tap through the roster, save. Each row shows the
member's belt, whether anything is paying for this class, and what they owe.
Classes can belong to a *training group*, which narrows the roster to that
group rather than the whole club.

**Payments.** Three models run side by side and members mix them freely:

| Model | Example | Behaviour |
|---|---|---|
| Monthly | 150₪ / 30 days | Unlimited classes in its window |
| Session card | 8 classes for 120₪ | Decrements per class, expires after N days |
| Single session | 25₪ | One class |

Buying is a **purchase**; paying is one or more **payments** against it, so a
part-payment is a real outstanding balance rather than a note. When a member
trains with nothing active the class is recorded as **uncovered** — never
blocked — and a later purchase can be *backfilled* over it. That is the
walk-in case: someone whose monthly lapsed trains on Sunday and pays on
Tuesday, and Sunday stops being a debt.

**Promotions.** A promotion needs **two** gates, not one:

1. **Time** — 6 months since the last promotion.
2. **Attendance** — 48 classes since the last promotion (6 months at ~8 a month).

The spreadsheet this replaces only ever checked the date, which is why a purple
belt promoted in September 2024 with **2 total classes** read as eligible from
March 2025 onward. The board groups members by what to do about them —
`due`, `overdue`, `coming up`, `short on attendance` — and says how short.

Promotions are append-only history, so a belt is never an overwritten cell. An
admin can award any grade (including several stripes at once) and can override
the gates; an override is recorded as one.

**Two interfaces.** An admin who also trains gets both from one login, with a
switcher in the header. Players see their own belt, progress toward the next
grade, attendance, balance, when the next payment falls due, the weekly
schedule, and what the team trained — and can edit their own name, date of
birth, phone and PIN.

---

## Running it locally

```bash
npm install
```

```bash
npm run db:migrate:local
```

```bash
npm run dev
```

That runs Vite on <http://localhost:5173> and the Worker on `:8787`, with the
API proxied across. The seeded local admin is **0599000001 / 24681357** and is
forced to change its PIN on first sign-in.

To get back to a clean, freshly-seeded database at any point — **stop the dev
server first**, because miniflare holds the SQLite file open and a server
started beforehand will keep serving the deleted one:

```bash
./scripts/dev-reset.sh
```

### Tests

```bash
npm run check
```

Type-checks both halves and runs 50 unit tests covering the promotion gates,
coverage resolution and date arithmetic (month-end clamping and the late-October
DST shift both matter here).

With the dev server running, `npm run e2e` drives the live API through 61
checks: login and lockout, the forced PIN change, attendance, all three payment
models, promotion award and undo, and the player/staff permission boundary.

---

## Deploying

### 1. Create the database

```bash
npx wrangler d1 create jui-jitsu-db
```

Copy the `database_id` it prints into `wrangler.toml`, replacing
`REPLACE_ME_AFTER_db:create`.

### 2. Apply the schema and seed

```bash
npm run db:migrate
```

### 3. Load the phone numbers

Phone numbers are personal data and are **not** in the repository. Create
`scripts/phones.local.json` (gitignored) mapping each member's `name_ar` to
their number:

```json
{ "علاء شريم": "0599123456", "نادر مشة": "0598765432" }
```

```bash
npm run db:seed
```

That regenerates `migrations/0002_seed.sql` *without* phones and writes
`scripts/phones.local.sql` *with* them. Apply the second separately:

```bash
npx wrangler d1 execute jui-jitsu-db --remote --file scripts/phones.local.sql
```

### 4. Create your admin account

```bash
node scripts/create-admin.mjs 0599101202 --role admin --member "احمد مقبول"
```

This hashes the PIN locally and prints the SQL to run — nothing reversible
reaches the repo. Linking `--member` means the account is a player too, so you
get both interfaces. Run the `--remote` command it prints.

### 5. Deploy

```bash
npm run deploy
```

The app is then at `https://jui-jitsu.<your-subdomain>.workers.dev`, or point a
custom domain at it from the Cloudflare dashboard.

---

## Hosting

Everything is inside Cloudflare's free tier, with room to spare:

| | Free limit | This team's load |
|---|---|---|
| Worker requests | 100,000 / day | a few hundred |
| D1 reads | 5,000,000 / day | thousands |
| D1 writes | 100,000 / day | ~40 per class |
| D1 storage | 5 GB | a few MB |

A nightly cron expires finished subscriptions, flips exhausted cards and prunes
old sessions and audit rows.

**One constraint worth knowing:** the Workers free plan allows ~10 ms of CPU per
request, which rules out a 100,000-iteration password hash — that alone is
50 ms+ and the request would be killed. PIN hashing therefore uses PBKDF2 at
12,000 iterations, and the real defence against guessing is **server-side
lockout** (5 wrong attempts → 15 minutes, escalating to 4 hours), not KDF cost.
That is the honest trade: a 6-digit PIN is only 10⁶ possibilities, so no
iteration count would save it from an attacker who already had the hash. If you
ever move to a paid plan, raise `PIN_ITERATIONS` and hashes upgrade silently on
each member's next sign-in.

Set the session secret once:

```bash
npx wrangler secret put SESSION_SECRET
```

### Backups

D1 has point-in-time recovery, and a full export is one command:

```bash
npx wrangler d1 export jui-jitsu-db --remote --output backup.sql
```

---

## Importing from the spreadsheet

`scripts/sheet-import.json` holds the data read out of the team's Google Sheet,
and `scripts/gen-seed.mjs` turns it into `migrations/0002_seed.sql`.

The importer cross-checks the sheet against itself: for every member, the
pre-2026 bucket plus the monthly columns must equal the promotions tab's total,
or it refuses to seed. All 25 reconcile.

Two things worth knowing about the import:

- **`سنة 2024` is really "everything before 2026".** The arithmetic only works
  if it is read that way, and it is stored as `legacy_attendance` rather than
  invented per-class rows.
- **"Classes since last promotion" had to be reconstructed.** The sheet has no
  per-class history, so the importer sums the monthly buckets from the
  promotion onward; a promotion on or before the 10th counts that whole month.
  It is an estimate, and the admin can correct any member's baseline.

The one free-text balance note in the sheet (`باقي بحسابه ٦٠ ش`) became a real
60₪ opening balance.

---

## Project layout

```
migrations/          schema, seed, training groups
scripts/             sheet import, admin creation, e2e, dev reset
src/shared/          domain logic shared by both halves
  promotion.ts         the two-gate eligibility engine
  billing.ts           entitlement resolution and coverage outlook
  dates.ts             calendar-day arithmetic, UTC throughout
src/server/          Hono routes, auth, D1 queries, nightly cron
src/client/          React app, Arabic-first, RTL
```

Domain logic lives in `src/shared` so the rules exist once: the server decides
authoritatively and the client shows the same arithmetic without a round trip.

---

## Still to come

- Telegram bot for reminders — chosen over Web Push because iOS only delivers
  web push to home-screen-installed apps, and the team already uses Telegram
- Training programme and technique videos on the player screen
- Offline check-in queue (the schema and UI already tolerate an uncovered
  member; the queue itself is not written yet)
