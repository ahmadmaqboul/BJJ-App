#!/usr/bin/env node
// Creates (or resets) a staff login and prints the SQL to apply it.
//
// Credentials are never committed: this hashes the PIN locally and emits only
// the hash, so nothing reversible reaches the repo or your shell history beyond
// the argument you type.
//
//   node scripts/create-admin.mjs 0599123456 --role admin --member "احمد مقبول"
//
// Then apply it:
//   npx wrangler d1 execute jui-jitsu-db --local  --command "<sql>"
//   npx wrangler d1 execute jui-jitsu-db --remote --command "<sql>"
//
// Pass --pin to choose one, otherwise a random 8-digit PIN is generated and
// printed. The account is flagged must_change_pin, so it must be changed on
// first login either way.

import { pbkdf2Sync, randomBytes, randomInt } from 'node:crypto';

// Must match src/server/auth.ts exactly, or the hash will not verify.
const ITERATIONS = Number(process.env.PIN_ITERATIONS) || 12_000;
const KEYLEN = 32;
const DIGEST = 'sha256';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

const login = positional[0];
if (!login) {
  console.error('usage: node scripts/create-admin.mjs <phone> [--role admin|coach] [--pin 123456] [--member "الاسم"]');
  process.exit(1);
}

const role = flag('role') ?? 'admin';
if (!['admin', 'coach'].includes(role)) {
  console.error(`--role must be admin or coach, got "${role}"`);
  process.exit(1);
}

const minLength = 6;
const pin = flag('pin') ?? String(randomInt(10_000_000, 99_999_999));
if (pin.length < minLength) {
  console.error(`PIN must be at least ${minLength} characters for a ${role} account.`);
  process.exit(1);
}

// Normalise the phone the same way the server does, so the login matches.
function normalisePhone(input) {
  const digits = input.replace(/[\s\-()]/g, '');
  const m =
    /^(?:\+972|00972)(5\d{8})$/.exec(digits) ??
    /^0(5\d{8})$/.exec(digits) ??
    /^(5\d{8})$/.exec(digits);
  if (m?.[1]) return `0${m[1]}`;
  if (/^\+?\d{9,15}$/.test(digits)) return digits.replace(/^\+/, '');
  return null;
}

const normalised = normalisePhone(login);
if (!normalised) {
  console.error(`"${login}" does not look like a usable phone number.`);
  process.exit(1);
}

const salt = randomBytes(16).toString('hex');
// The salt is hashed as the UTF-8 bytes of its hex string, matching the
// Web Crypto call in the Worker (TextEncoder over the hex string).
const hash = pbkdf2Sync(pin.normalize('NFKC'), Buffer.from(salt, 'utf8'), ITERATIONS, KEYLEN, DIGEST).toString('hex');

const memberName = flag('member');
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

// Links to the member row by name when one is given, so the staff account also
// has a player profile (attendance, belt, payments) attached.
const memberExpr = memberName ? `(SELECT id FROM members WHERE name_ar = ${q(memberName)})` : 'NULL';

const sql = `INSERT INTO users (member_id, login, role, pin_hash, pin_salt, pin_iterations, must_change_pin) VALUES (${memberExpr}, ${q(normalised)}, ${q(role)}, ${q(hash)}, ${q(salt)}, ${ITERATIONS}, 1) ON CONFLICT(login) DO UPDATE SET role = excluded.role, pin_hash = excluded.pin_hash, pin_salt = excluded.pin_salt, pin_iterations = excluded.pin_iterations, must_change_pin = 1, disabled = 0, failed_attempts = 0, locked_until = NULL;`;

console.log('');
console.log(`  login .... ${normalised}`);
console.log(`  role ..... ${role}`);
console.log(`  PIN ...... ${pin}      <- write this down, it is not recoverable`);
if (memberName) console.log(`  member ... ${memberName}`);
console.log('');
console.log('Apply locally:');
console.log(`  npx wrangler d1 execute jui-jitsu-db --local --command ${JSON.stringify(sql)}`);
console.log('');
console.log('Apply in production:');
console.log(`  npx wrangler d1 execute jui-jitsu-db --remote --command ${JSON.stringify(sql)}`);
console.log('');
