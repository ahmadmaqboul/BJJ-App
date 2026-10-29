#!/usr/bin/env node
// Writes a known admin login straight into the LOCAL miniflare D1 file, so
// `npm run dev` and `npm run e2e` have something to log in with.
//
// Local only. The PIN is a fixed, publicly-known development credential and is
// useless against production, which has its own database and its own accounts
// created via scripts/create-admin.mjs.

import { DatabaseSync } from 'node:sqlite';
import { globSync } from 'node:fs';
import { pbkdf2Sync, randomBytes } from 'node:crypto';

export const TEST_ADMIN_LOGIN = '0599000001';
export const TEST_ADMIN_PIN = '24681357';

const ITERATIONS = 12_000;

const files = globSync('.wrangler/state/v3/d1/**/*.sqlite');
if (!files.length) {
  console.error('No local D1 database found. Run `npm run db:migrate:local` first.');
  process.exit(1);
}

const db = new DatabaseSync(files[0]);
const salt = randomBytes(16).toString('hex');
const hash = pbkdf2Sync(
  TEST_ADMIN_PIN.normalize('NFKC'),
  Buffer.from(salt, 'utf8'),
  ITERATIONS,
  32,
  'sha256',
).toString('hex');

const member = db
  .prepare(`SELECT id FROM members WHERE name_ar = ? LIMIT 1`)
  .get('احمد مقبول');

db.prepare(
  `INSERT INTO users (member_id, login, role, pin_hash, pin_salt, pin_iterations, must_change_pin)
   VALUES (?, ?, 'admin', ?, ?, ?, 1)
   ON CONFLICT(login) DO UPDATE SET
     pin_hash = excluded.pin_hash,
     pin_salt = excluded.pin_salt,
     pin_iterations = excluded.pin_iterations,
     must_change_pin = 1,
     disabled = 0,
     failed_attempts = 0,
     locked_until = NULL`,
).run(member?.id ?? null, TEST_ADMIN_LOGIN, hash, salt, ITERATIONS);

// Any session from a previous run is stale once the PIN is rewritten.
db.prepare(`DELETE FROM auth_sessions`).run();
db.close();

console.log(`local admin ready — login ${TEST_ADMIN_LOGIN} / PIN ${TEST_ADMIN_PIN}`);
