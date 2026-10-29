// End-to-end exercise of the API against the local Worker + seeded D1.
const BASE = 'http://127.0.0.1:8787';
let cookie = '';
let failures = 0;

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  let payload;
  const text = await res.text();
  try { payload = JSON.parse(text); } catch { payload = text.slice(0, 200); }
  return { status: res.status, body: payload };
}

function check(label, cond, detail) {
  if (cond) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ''}`);
  }
}

console.log('\n== auth ==');
let r = await call('POST', '/api/auth/login', { login: '0599000001', pin: '11112222' });
check('wrong PIN rejected', r.status === 401, r.body);

r = await call('POST', '/api/auth/login', { login: '0599000001', pin: '24681357' });
check('correct PIN accepted', r.status === 200, r.body);
check('admin role returned', r.body?.user?.role === 'admin', r.body?.user);
check('must change PIN on first login', r.body?.user?.mustChangePin === true);

r = await call('GET', '/api/members');
check('API blocked until PIN is changed', r.status === 403 && r.body?.error === 'pin_change_required', r.body);

r = await call('POST', '/api/auth/change-pin', { currentPin: '24681357', newPin: '1111' });
check('weak PIN refused for admin (needs 6+)', r.status === 400, r.body);

r = await call('POST', '/api/auth/change-pin', { currentPin: '24681357', newPin: '31415926' });
check('PIN change accepted', r.status === 200, r.body);

r = await call('GET', '/api/auth/me');
check('session still valid after PIN change', r.body?.user?.role === 'admin', r.body);

console.log('\n== members ==');
r = await call('GET', '/api/members');
const members = r.body?.members ?? [];
check('25 members listed', members.length === 25, members.length);
check('19 active', members.filter((m) => m.status === 'active').length === 19);
const alaa = members.find((m) => m.nameAr === 'علاء شريم');
check('علاء شريم is purple with 126 classes', alaa?.belt === 'purple' && alaa?.totalClasses === 126, alaa);

const hasan = members.find((m) => m.nameAr === 'حسن حجاوي');
check('حسن حجاوي owes 60 ILS from the sheet note', hasan?.balance?.outstandingMinor === 6000, hasan?.balance);

console.log('\n== promotion board ==');
r = await call('GET', '/api/promotions/board');
const board = r.body;
check('board returns', r.status === 200, r.body);
const ali = board?.rows?.find((x) => x.nameAr === 'علي حموضة');
check(
  'علي حموضة (purple, Sept 2024, 2 classes) is blocked on attendance, not due',
  ali?.status === 'blocked_attendance',
  { status: ali?.status, short: ali?.classesShort },
);
check('and is reported short by 48 classes', ali?.classesShort === 48, ali?.classesShort);
const inactiveCount = board?.counts?.inactive ?? 0;
check('6 inactive members excluded from promotion flow', inactiveCount === 6, board?.counts);

console.log('\n== class + attendance ==');
r = await call('POST', '/api/sessions', {
  date: '2026-10-29',
  startTime: '19:00',
  classType: 'gi',
  techniqueTitle: 'عبور الحراسة - knee slice',
});
const sessionId = r.body?.session?.id;
check('class created', r.status === 201 && !!sessionId, r.body);

r = await call('POST', '/api/sessions', { date: '2026-10-29', startTime: '19:00', classType: 'gi' });
check('duplicate class returns the existing one', r.body?.existed === true, r.body);

r = await call('GET', `/api/sessions/${sessionId}`);
const roster = r.body?.roster ?? [];
check('roster covers the 19 active members', roster.length === 19, roster.length);
check('everyone previews as uncovered before any purchase',
  roster.every((x) => x.preview.coverage === 'uncovered'),
  roster.slice(0, 2).map((x) => x.preview));

const alaaId = alaa.id;
const hamza = members.find((m) => m.nameAr === 'حمزة الصدر');

r = await call('POST', `/api/sessions/${sessionId}/attendance`, {
  entries: [
    { memberId: alaaId, status: 'present' },
    { memberId: hamza.id, status: 'present' },
    { memberId: members.find((m) => m.nameAr === 'زيد').id, status: 'absent' },
  ],
});
check('attendance saved', r.status === 200 && r.body?.saved === 3, r.body);
check('present members recorded uncovered (no plan yet)',
  r.body?.entries?.filter((e) => e.coverage === 'uncovered').length === 2, r.body?.entries);

r = await call('GET', `/api/members/${alaaId}`);
check('class total rose 126 -> 127', r.body?.member?.totalClasses === 127, r.body?.member?.totalClasses);
check('classes since last promotion now 9', r.body?.eligibility?.classesSince === 9, r.body?.eligibility);

console.log('\n== the walk-in case ==');
// حمزة trained today with nothing active. Sell him a single session and
// backfill it over the class he already did.
r = await call('GET', '/api/billing/plans');
const plans = r.body?.plans ?? [];
const single = plans.find((p) => p.type === 'single');
const monthly = plans.find((p) => p.type === 'monthly');
const pack = plans.find((p) => p.type === 'package');
check('4 plans seeded across all three models', plans.length === 4 && !!single && !!monthly && !!pack, plans.map((p) => p.type));

r = await call('POST', '/api/billing/purchases', {
  memberId: hamza.id,
  planId: single.id,
  payNow: true,
  method: 'cash',
  backfill: true,
});
check('single session sold and paid', r.status === 201, r.body);
check('backfilled over the class already trained', r.body?.backfilled === 1, r.body?.backfilled);
check('member owes nothing after paying', r.body?.balance?.outstandingMinor === 0, r.body?.balance);

r = await call('GET', `/api/sessions/${sessionId}`);
const hamzaRow = r.body.roster.find((x) => x.memberId === hamza.id);
check('his attendance now reads as covered by a single', hamzaRow?.coverage === 'single', hamzaRow);

// علاء buys a monthly instead; it should cover unlimited classes.
r = await call('POST', '/api/billing/purchases', {
  memberId: alaaId, planId: monthly.id, payNow: true, backfill: true,
});
check('monthly sold', r.status === 201, r.body);
check('monthly backfilled his uncovered class', r.body?.backfilled === 1, r.body?.backfilled);

r = await call('GET', `/api/sessions/${sessionId}`);
const alaaRow = r.body.roster.find((x) => x.memberId === alaaId);
check('covered by monthly', alaaRow?.coverage === 'monthly', alaaRow);

// A second class on the monthly must not consume anything.
r = await call('POST', '/api/sessions', { date: '2026-10-30', startTime: '19:00', classType: 'nogi' });
const s2 = r.body.session.id;
r = await call('POST', `/api/sessions/${s2}/attendance`, {
  entries: [{ memberId: alaaId, status: 'present' }, { memberId: hamza.id, status: 'present' }],
});
const byId = Object.fromEntries(r.body.entries.map((e) => [e.memberId, e]));
check('monthly covers the next class too', byId[alaaId]?.coverage === 'monthly', byId[alaaId]);
check('his single was already used, so he is uncovered again', byId[hamza.id]?.coverage === 'uncovered', byId[hamza.id]);

console.log('\n== package consumption ==');
r = await call('POST', '/api/billing/purchases', { memberId: hamza.id, planId: pack.id, payNow: true });
const packPurchase = r.body?.purchase;
check('8-session card sold', packPurchase?.sessions_total === 8, packPurchase);

// Re-saving the same attendance must not double-charge.
r = await call('POST', `/api/sessions/${s2}/attendance`, {
  entries: [{ memberId: hamza.id, status: 'present' }],
});
check('re-save keeps the existing coverage, no double charge',
  r.body?.entries?.[0]?.coverage === 'uncovered', r.body?.entries);

r = await call('POST', '/api/sessions', { date: '2026-11-01', classType: 'gi' });
const s3 = r.body.session.id;
r = await call('POST', `/api/sessions/${s3}/attendance`, { entries: [{ memberId: hamza.id, status: 'present' }] });
check('new class draws on the package', r.body?.entries?.[0]?.coverage === 'package', r.body?.entries);
check('7 sessions left', r.body?.entries?.[0]?.remaining === 7, r.body?.entries?.[0]);

// Flipping him to absent should hand the session back.
r = await call('POST', `/api/sessions/${s3}/attendance`, { entries: [{ memberId: hamza.id, status: 'absent' }] });
r = await call('GET', `/api/billing/members/${hamza.id}`);
const card = (r.body?.purchases ?? []).find((p) => p.id === packPurchase.id);
check('marking absent returns the consumed session', card?.sessions_used === 0, card);

console.log('\n== promotions ==');
// احمد مقبول is white/4 -> next award is the blue belt.
const ahmad = members.find((m) => m.nameAr === 'احمد مقبول');
r = await call('POST', `/api/promotions/member/${ahmad.id}`, {});
check('promotion refused while attendance gate is short',
  r.status === 409 && String(r.body?.error).startsWith('not_eligible'), r.body?.error);

r = await call('POST', `/api/promotions/member/${ahmad.id}`, { override: true, promotedOn: '2026-10-29' });
check('override awards it', r.status === 201, r.body);
check('white/4 -> blue/0', r.body?.member?.belt === 'blue' && r.body?.member?.stripes === 0, r.body?.member);
check('class baseline reset so the next cycle starts at zero',
  r.body?.member?.classesAtLastPromotion === 115, r.body?.member?.classesAtLastPromotion);

r = await call('GET', `/api/members/${ahmad.id}`);
check('eligibility now counts 0 classes since promotion', r.body?.eligibility?.classesSince === 0, r.body?.eligibility);
check('belt history kept both rows', (r.body?.promotions ?? []).length === 2, (r.body?.promotions ?? []).length);

r = await call('DELETE', `/api/promotions/member/${ahmad.id}/latest`);
check('undo restores white/4', r.body?.member?.belt === 'white' && r.body?.member?.stripes === 4, r.body?.member);
check('and restores the old class baseline', r.body?.member?.classesAtLastPromotion === 107, r.body?.member?.classesAtLastPromotion);

console.log('\n== permissions ==');
r = await call('POST', `/api/members/${hamza.id}/login`, { role: 'player' });
check('login refused when the member has no phone number', r.status === 400, r.body);

const playerLogin = '0599000042';
r = await call('POST', `/api/members/${hamza.id}/login`, { role: 'player', login: playerLogin });
const playerPin = r.body?.pin;
check('player login created with a one-time PIN', r.status === 200 && !!playerPin, r.body);

const adminCookie = cookie;
cookie = '';
r = await call('POST', '/api/auth/login', { login: playerLogin, pin: playerPin });
check('player can log in', r.status === 200, r.body);
r = await call('POST', '/api/auth/change-pin', { currentPin: playerPin, newPin: '445566' });
check('player sets their own PIN', r.status === 200, r.body);

r = await call('GET', '/api/members');
check('player cannot list the roster', r.status === 403, r.body);
r = await call('GET', '/api/billing/outstanding');
check('player cannot see who owes money', r.status === 403, r.body);
r = await call('GET', `/api/members/${alaaId}`);
check('player cannot read another member', r.status === 403, r.body);
r = await call('GET', `/api/members/${hamza.id}`);
check('player can read their own record', r.status === 200, r.body?.error);
r = await call('GET', '/api/me/overview');
check('player overview works', r.status === 200 && r.body?.member?.nameAr === 'حمزة الصدر', r.body?.error);
check('player sees their own belt progress', typeof r.body?.eligibility?.progress === 'number', r.body?.eligibility);
check('player sees what the team worked on', Array.isArray(r.body?.recentClasses), r.body?.recentClasses);

cookie = adminCookie;
r = await call('GET', '/api/admin/dashboard');
check('admin dashboard works', r.status === 200, r.body?.error);
check('dashboard counts only this month\'s classes (2 of the 3 created)',
  r.body?.month?.classes === 2, r.body?.month);

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
