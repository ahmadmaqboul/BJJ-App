// End-to-end exercise of the API against the local Worker + seeded D1.
const BASE = 'http://127.0.0.1:8787';

// Anchored to the server's own idea of today so the suite does not rot
// overnight — several assertions depend on a class being dated today.
const health = await (await fetch(`${BASE}/api/health`)).json();
const TODAY = health.today;
const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
};
const TOMORROW = addDays(TODAY, 1);
const daysBetween = (from, to) => {
  const ms = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
};
const IN_THREE_DAYS = addDays(TODAY, 3);
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
check('حسن حجاوي holds 60 ILS CREDIT from the sheet note (the club owes him)',
  hasan?.balance?.outstandingMinor === -6000, hasan?.balance);

// Six members had a payment date in the sheet and now carry a real subscription.
const everSubscribed = members.filter((m) => m.subscription?.state !== 'never');
check('6 members imported with a subscription from the sheet',
  everSubscribed.length === 6, everSubscribed.map((m) => `${m.nameAr}:${m.subscription.state}`));

// The sheet's dates are fixed history, so some of those lapse as time passes.
const liveSubs = members.filter(
  (m) => m.subscription?.state === 'subscribed' || m.subscription?.state === 'ending_soon',
);
check('every live one is among the six imported',
  liveSubs.every((m) => everSubscribed.includes(m)), liveSubs.map((m) => m.nameAr));

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
check('and is reported short by 46 classes (48 required, 2 done)',
  ali?.classesShort === 46, ali?.classesShort);
const inactiveCount = board?.counts?.inactive ?? 0;
check('6 inactive members excluded from promotion flow', inactiveCount === 6, board?.counts);

console.log('\n== class + attendance ==');
r = await call('POST', '/api/sessions', {
  date: TODAY,
  startTime: '19:00',
  classType: 'gi',
  techniqueTitle: 'عبور الحراسة - knee slice',
});
const sessionId = r.body?.session?.id;
check('class created', r.status === 201 && !!sessionId, r.body);

r = await call('POST', '/api/sessions', { date: TODAY, startTime: '19:00', classType: 'gi' });
check('duplicate class returns the existing one', r.body?.existed === true, r.body);

r = await call('GET', `/api/sessions/${sessionId}`);
const roster = r.body?.roster ?? [];
check('roster covers the 19 active members', roster.length === 19, roster.length);
// Exactly the members whose imported subscription is still live preview as
// covered — a count, not a constant, because the sheet's dates keep ageing.
const liveIds = new Set(liveSubs.map((m) => m.id));
check('members with a live subscription preview as monthly',
  roster.filter((x) => x.preview.coverage === 'monthly').length === liveIds.size,
  { previewed: roster.filter((x) => x.preview.coverage === 'monthly').length, live: liveIds.size });
check('members the sheet never recorded paying preview as uncovered',
  roster.some((x) => x.preview.coverage === 'uncovered'),
  roster.slice(0, 2).map((x) => x.preview));

const alaaId = alaa.id;
// زيد has no payment date in the sheet, so nothing covers him — which is what
// the walk-in flow below needs. حمزة now arrives with a subscription.
const hamza = members.find((m) => m.nameAr === 'زيد');
check('زيد starts with no subscription', hamza?.subscription?.state === 'never', hamza?.subscription);

r = await call('POST', `/api/sessions/${sessionId}/attendance`, {
  entries: [
    { memberId: alaaId, status: 'present' },
    { memberId: hamza.id, status: 'present' },
    { memberId: members.find((m) => m.nameAr === 'أحمد زبلح').id, status: 'absent' },
  ],
});
check('attendance saved', r.status === 200 && r.body?.saved === 3, r.body);
check('both present members recorded uncovered (neither has a plan)',
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
r = await call('POST', '/api/sessions', { date: TOMORROW, startTime: '19:00', classType: 'nogi' });
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

r = await call('POST', '/api/sessions', { date: IN_THREE_DAYS, classType: 'gi' });
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
// احمد مقبول is blue/0 since the sheet update, so the next award is stripe 1.
const ahmad = members.find((m) => m.nameAr === 'احمد مقبول');
check('احمد مقبول imported as a blue belt with no stripes',
  ahmad.belt === 'blue' && ahmad.stripes === 0, { belt: ahmad.belt, stripes: ahmad.stripes });
r = await call('POST', `/api/promotions/member/${ahmad.id}`, {});
check('promotion refused while attendance gate is short',
  r.status === 409 && String(r.body?.error).startsWith('not_eligible'), r.body?.error);

r = await call('POST', `/api/promotions/member/${ahmad.id}`, { override: true, promotedOn: TODAY });
check('override awards it', r.status === 201, r.body);
check('blue/0 -> blue/1', r.body?.member?.belt === 'blue' && r.body?.member?.stripes === 1, r.body?.member);
check('class baseline reset so the next cycle starts at zero',
  r.body?.member?.classesAtLastPromotion === 115, r.body?.member?.classesAtLastPromotion);

r = await call('GET', `/api/members/${ahmad.id}`);
check('eligibility now counts 0 classes since promotion', r.body?.eligibility?.classesSince === 0, r.body?.eligibility);
check('belt history kept both rows', (r.body?.promotions ?? []).length === 2, (r.body?.promotions ?? []).length);

r = await call('DELETE', `/api/promotions/member/${ahmad.id}/latest`);
check('undo restores blue/0', r.body?.member?.belt === 'blue' && r.body?.member?.stripes === 0, r.body?.member);
check('and restores the old class baseline', r.body?.member?.classesAtLastPromotion === 107, r.body?.member?.classesAtLastPromotion);

console.log('\n== permissions ==');
// Every member was imported with a phone, so omitting the login uses theirs.
r = await call('POST', `/api/members/${hamza.id}/login`, { role: 'player' });
check('login defaults to the member\'s own phone number',
  r.status === 200 && r.body?.login === hamza.phone, { got: r.body?.login, want: hamza.phone });

// Re-issuing against an explicit number moves the login and reissues the PIN.
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
check('player overview works', r.status === 200 && r.body?.member?.nameAr === hamza.nameAr, r.body?.error);
check('player sees their own belt progress', typeof r.body?.eligibility?.progress === 'number', r.body?.eligibility);
check('player sees what the team worked on', Array.isArray(r.body?.recentClasses), r.body?.recentClasses);

cookie = adminCookie;
r = await call('GET', '/api/admin/dashboard');
check('admin dashboard works', r.status === 200, r.body?.error);
{
  // How many of the three created classes land in the current month depends
  // on where today sits in it.
  const thisMonth = [TODAY, TOMORROW, IN_THREE_DAYS].filter(
    (d) => d.slice(0, 7) === TODAY.slice(0, 7),
  ).length;
  check(`dashboard counts only this month's classes (${thisMonth} of the 3 created)`,
    r.body?.month?.classes === thisMonth, { got: r.body?.month?.classes, want: thisMonth });
}

console.log('\n== runs-the-register feature ==');
// An add-on to a member, not a role: it opens classes and nothing else, and
// it carries an end date so it lapses on its own.
const helper = members.find((m) => m.nameAr === 'علاء عاشور');

r = await call('POST', `/api/members/${helper.id}/attendance-access`, { until: TODAY });
check('refused before the member has a login',
  r.status === 409 && r.body?.error === 'login_required_first', r.body);

r = await call('POST', `/api/members/${helper.id}/login`, { role: 'player' });
const helperPin = r.body?.pin;
const helperLogin = r.body?.login;

r = await call('POST', `/api/members/${helper.id}/attendance-access`, { until: '2020-01-01' });
check('a past end date is refused', r.status === 400, r.body);

r = await call('POST', `/api/members/${helper.id}/attendance-access`, { until: addDays(TODAY, 7) });
check('granted for a week', r.status === 200 && r.body?.attendanceUntil === addDays(TODAY, 7), r.body);

const adminCookie2 = cookie;
cookie = '';
await call('POST', '/api/auth/login', { login: helperLogin, pin: helperPin });
await call('POST', '/api/auth/change-pin', { currentPin: helperPin, newPin: '778899' });

r = await call('GET', '/api/auth/me');
check('the helper holds the capability but is still a player',
  r.body?.user?.canTakeAttendance === true && r.body?.user?.role === 'player', r.body?.user);

r = await call('POST', '/api/sessions', { date: TODAY, startTime: '18:00', classType: 'gi' });
check('helper can open a class', r.status === 201 || r.body?.existed === true, r.body?.error);
const helperSession = r.body.session.id;

r = await call('GET', `/api/sessions/${helperSession}`);
check('helper can open the roster', r.status === 200, r.body?.error);
check('balances are withheld from the helper',
  r.body.roster.every((x) => x.outstandingMinor === null), r.body.roster?.[0]);
check('coverage is withheld from the helper',
  r.body.roster.every((x) => x.preview.coverage === null), r.body.roster?.[0]?.preview);

r = await call('POST', `/api/sessions/${helperSession}/attendance`, {
  entries: [{ memberId: alaaId, status: 'present' }],
});
check('helper can record attendance', r.status === 200, r.body?.error);

check('helper cannot list members', (await call('GET', '/api/members')).status === 403);
check('helper cannot see who owes money', (await call('GET', '/api/billing/outstanding')).status === 403);
check('helper cannot see the promotion board', (await call('GET', '/api/promotions/board')).status === 403);
check('helper cannot export', (await call('GET', '/api/admin/export/members.csv')).status === 403);

cookie = adminCookie2;

console.log('\n== export ==');
{
  const res = await fetch(`${BASE}/api/admin/export/members.csv`, { headers: { cookie } });
  const bytes = new Uint8Array(await res.arrayBuffer());
  check('csv downloads as a file',
    res.status === 200 && (res.headers.get('content-disposition') ?? '').includes('attachment'),
    res.headers.get('content-disposition'));
  // Without the BOM, Excel on Windows renders every Arabic name as mojibake.
  check('starts with a UTF-8 BOM',
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
    [...bytes.slice(0, 3)]);

  const text = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
  const lines = text.split('\r\n');
  const head = lines[0].split(',');
  check('one row per member', lines.length === 26, lines.length);
  check('carries last payment and subscription end',
    head.includes('تاريخ اخر دفعة') && head.includes('الاشتراك ساري لغاية'), head.slice(-5));
  check('carries 12 months of attendance',
    head.filter((h) => h.startsWith('شهر ')).length === 12,
    head.filter((h) => h.startsWith('شهر ')).length);
}

console.log('\n== paying late for days already trained ==');
{
  // The day cover starts and the day the money arrives are separate facts.
  const late = members.find((m) => m.nameAr === 'أحمد زبلح');
  const fiveAgo = addDays(TODAY, -5);
  const tenAgo = addDays(TODAY, -10);

  r = await call('POST', '/api/sessions', { date: fiveAgo, startTime: '19:00', classType: 'gi' });
  const pastSession = r.body.session.id;
  await call('POST', `/api/sessions/${pastSession}/attendance`, {
    entries: [{ memberId: late.id, status: 'present' }],
  });
  r = await call('GET', `/api/sessions/${pastSession}`);
  check('trained five days ago with nothing covering it',
    r.body.roster.find((x) => x.memberId === late.id)?.coverage === 'uncovered');

  const monthlyPlan = (await call('GET', '/api/billing/plans')).body.plans
    .find((p) => p.type === 'monthly');

  r = await call('POST', '/api/billing/purchases', {
    memberId: late.id, planId: monthlyPlan.id, payNow: true, method: 'cash',
    backfill: true, validFrom: tenAgo, paidOn: TODAY,
  });
  check('subscription starts on the backdated day', r.body?.purchase?.valid_from === tenAgo, r.body?.purchase);
  check('it covers the class already trained', r.body?.backfilled === 1, r.body?.backfilled);

  const bill = (await call('GET', `/api/billing/members/${late.id}`)).body;
  check('the payment is dated today, not the start day',
    bill.payments[0]?.paid_on === TODAY && TODAY !== tenAgo, bill.payments[0]?.paid_on);

  r = await call('GET', `/api/sessions/${pastSession}`);
  check('the past class now reads as covered',
    r.body.roster.find((x) => x.memberId === late.id)?.coverage === 'monthly');
}

console.log('\n== correcting a subscription after the fact ==');
{
  // Moving a start date must re-resolve what the subscription pays for, or
  // the ledger drifts: classes outside the new window stay wrongly covered.
  const fixer = members.find((m) => m.nameAr === 'سعيد جوابرة');

  r = await call('POST', '/api/sessions', {
    date: addDays(TODAY, -5), startTime: '17:00', classType: 'gi',
  });
  const past = r.body.session.id;
  await call('POST', `/api/sessions/${past}/attendance`, {
    entries: [{ memberId: fixer.id, status: 'present' }],
  });

  const monthlyPlan = (await call('GET', '/api/billing/plans')).body.plans
    .find((p) => p.type === 'monthly');
  r = await call('POST', '/api/billing/purchases', {
    memberId: fixer.id, planId: monthlyPlan.id, payNow: true,
    backfill: true, validFrom: addDays(TODAY, -7),
  });
  const purchaseId = r.body.purchase.id;
  const spanBefore = r.body.purchase.valid_until;

  const coverage = async () =>
    (await call('GET', `/api/sessions/${past}`)).body.roster
      .find((x) => x.memberId === fixer.id)?.coverage;

  check('the backdated subscription covers the past class', (await coverage()) === 'monthly');

  // Move the start past that class.
  r = await call('PATCH', `/api/billing/purchases/${purchaseId}`, {
    validFrom: addDays(TODAY, -2),
  });
  check('moving the start keeps the window the same length',
    daysBetween(addDays(TODAY, -2), r.body.purchase.valid_until) ===
      daysBetween(addDays(TODAY, -7), spanBefore),
    { was: spanBefore, now: r.body.purchase.valid_until });
  check('the class it no longer spans is released', r.body?.released === 1, r.body);
  check('and reads as unpaid again', (await coverage()) === 'uncovered');

  // Move it back.
  r = await call('PATCH', `/api/billing/purchases/${purchaseId}`, {
    validFrom: addDays(TODAY, -7),
  });
  check('moving it back picks the class up again', r.body?.backfilled === 1, r.body);
  check('and it reads as covered', (await coverage()) === 'monthly');

  // Correcting the amount leaves the member in credit.
  r = await call('PATCH', `/api/billing/purchases/${purchaseId}`, { amountMinor: 9000 });
  check('lowering the amount below what was paid leaves credit',
    r.body?.balance?.outstandingMinor === -6000, r.body?.balance);
}

console.log('\n== the club total is one number, not two ==');
{
  // The dashboard and the payments screen each used to compute this, and
  // disagreed: one counted coaches, the other did not.
  const agree = async (label) => {
    const d = (await call('GET', '/api/admin/dashboard')).body;
    const o = (await call('GET', '/api/billing/outstanding')).body;
    check(`${label}: both screens report the same total`,
      d.outstandingMinor === o.totalOutstandingMinor && d.membersOwing === o.membersOwing,
      { dashboard: [d.outstandingMinor, d.membersOwing], payments: [o.totalOutstandingMinor, o.membersOwing] });
    return d;
  };

  const before = await agree('to start with');

  // A coach who owes must not move the club total.
  const coach = members.find((m) => m.nameAr === 'حميد يعيش');
  await call('PATCH', `/api/members/${coach.id}`, { memberType: 'coach' });
  const plan = (await call('GET', '/api/billing/plans')).body.plans.find((p) => p.type === 'monthly');
  await call('POST', '/api/billing/purchases', { memberId: coach.id, planId: plan.id, payNow: false });

  const withCoachDebt = await agree('with a coach owing');
  check('a coach owing does not count toward the club total',
    withCoachDebt.outstandingMinor === before.outstandingMinor,
    { before: before.outstandingMinor, after: withCoachDebt.outstandingMinor });

  // A player who owes must.
  const payer = members.find((m) => m.nameAr === 'عمر عنبتاوي');
  await call('POST', '/api/billing/purchases', { memberId: payer.id, planId: plan.id, payNow: false });

  const withPlayerDebt = await agree('with a player owing');
  check('a player owing does count',
    withPlayerDebt.outstandingMinor === before.outstandingMinor + plan.price_minor,
    { before: before.outstandingMinor, after: withPlayerDebt.outstandingMinor });
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
