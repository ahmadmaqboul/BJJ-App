import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Belt, Coverage, MemberStatus, PaymentMethod, PlanType } from '../shared/types';
import type { PromotionStatus } from '../shared/promotion';

/**
 * Arabic is the default and the source of truth for wording — the team's data,
 * names and notes are all Arabic. English is a full second column rather than a
 * fallback, so a visiting coach can use the app.
 */
const ar = {
  'app.name': 'JUI-Jitsu',
  'app.tagline': 'الحضور والاشتراكات والترقيات',

  'nav.home': 'الرئيسية',
  'nav.classes': 'الحصص',
  'nav.members': 'اللاعبون',
  'nav.payments': 'الاشتراكات',
  'nav.promotions': 'الترقيات',
  'nav.settings': 'الإعدادات',
  'nav.me': 'ملفي',

  'login.title': 'تسجيل الدخول',
  'login.phone': 'رقم الجوال',
  'login.pin': 'الرمز السري',
  'login.submit': 'دخول',
  'login.working': 'جارٍ الدخول…',
  'login.hint': 'إذا نسيت الرمز، اطلب من المدرب إعادة تعيينه.',

  'pin.title': 'اختر رمزًا جديدًا',
  'pin.why': 'هذا أول دخول لك، فلازم تغيّر الرمز المؤقت.',
  'pin.current': 'الرمز الحالي',
  'pin.new': 'الرمز الجديد',
  'pin.confirm': 'تأكيد الرمز الجديد',
  'pin.submit': 'حفظ الرمز',
  'pin.mismatch': 'الرمزان غير متطابقين.',

  'dash.title': 'نظرة عامة',
  'dash.activeMembers': 'لاعبون نشطون',
  'dash.classesThisMonth': 'حصص هذا الشهر',
  'dash.checkinsThisMonth': 'حضور هذا الشهر',
  'dash.collected': 'المحصّل هذا الشهر',
  'dash.outstanding': 'مبالغ غير مدفوعة',
  'dash.membersOwing': '{n} لاعب عليهم رصيد',
  'dash.promotionsDue': 'ترقيات مستحقة',
  'dash.blockedByAttendance': '{n} ينقصهم حضور',
  'dash.uncovered': 'حصص غير مدفوعة',
  'dash.lastClass': 'آخر حصة',
  'dash.noClasses': 'ما في حصص مسجّلة بعد.',
  'dash.startClass': 'ابدأ حصة اليوم',
  'dash.openClass': 'افتح الحصة',
  'dash.quickActions': 'إجراءات سريعة',

  'classes.title': 'الحصص',
  'classes.new': 'حصة جديدة',
  'classes.date': 'التاريخ',
  'classes.time': 'الوقت',
  'classes.type': 'نوع الحصة',
  'classes.technique': 'التكنيك',
  'classes.techniquePlaceholder': 'مثال: عبور الحراسة — knee slice',
  'classes.notes': 'ملاحظات الحصة',
  'classes.create': 'إنشاء الحصة',
  'classes.present': 'حاضر',
  'classes.attendees': 'مسجّلون',
  'classes.empty': 'ما في حصص في هذه الفترة.',
  'classes.close': 'إغلاق الحصة',
  'classes.reopen': 'إعادة فتح الحصة',
  'classes.closed': 'مغلقة',

  'checkin.title': 'تسجيل الحضور',
  'checkin.save': 'حفظ الحضور',
  'checkin.saving': 'جارٍ الحفظ…',
  'checkin.saved': 'تم حفظ الحضور',
  'checkin.allPresent': 'الكل حاضر',
  'checkin.clear': 'مسح الكل',
  'checkin.search': 'ابحث عن لاعب',
  'checkin.unsaved': '{n} تغيير غير محفوظ',
  'checkin.pendingSync': 'محفوظ على الجهاز — سيُرسل عند عودة الشبكة',
  'checkin.offline': 'لا يوجد اتصال',
  'checkin.charge': 'استوفِ الرسوم',
  'checkin.presentCount': '{n} حاضر من {total}',

  'att.present': 'حاضر',
  'att.absent': 'غائب',
  'att.late': 'متأخر',
  'att.excused': 'بعذر',

  'members.title': 'اللاعبون',
  'members.new': 'لاعب جديد',
  'members.search': 'ابحث بالاسم أو الجوال',
  'members.all': 'الكل',
  'members.empty': 'ما في لاعبين مطابقين.',
  'members.classes': 'حصة',
  'members.noPhone': 'بدون رقم',
  'members.noLogin': 'بدون حساب',
  'members.createLogin': 'أنشئ حساب دخول',
  'members.resetPin': 'إعادة تعيين الرمز',
  'members.removeLogin': 'حذف الحساب',
  'members.pinIssued': 'الرمز المؤقت — اكتبه الآن، ما بينعرض مرة ثانية',
  'members.pinIssuedFor': 'الرمز المؤقت لـ {name}',
  'members.copyPin': 'نسخ',
  'members.copied': 'تم النسخ',
  'members.role': 'الصلاحية',
  'members.name': 'الاسم',
  'members.phone': 'رقم الجوال',
  'members.birthDate': 'تاريخ الميلاد',
  'members.joinDate': 'تاريخ الانتساب',
  'members.notes': 'ملاحظات',
  'members.save': 'حفظ',
  'members.belt': 'الحزام',
  'members.stripes': 'الخطوط',
  'members.lastPromotion': 'آخر ترقية',
  'members.totalClasses': 'إجمالي الحضور',
  'members.status': 'الحالة',
  'members.profile': 'ملف اللاعب',
  'members.history': 'سجل الحضور الشهري',
  'members.beltHistory': 'سجل الأحزمة',
  'members.recentAttendance': 'آخر الحصص',
  'members.deleteLoginConfirm': 'حذف حساب الدخول لهذا اللاعب؟',
  'members.imported': 'مستورد من الشيت',

  'status.active': 'نشط',
  'status.inactive': 'غير نشط',
  'status.paused': 'موقوف مؤقتًا',

  'role.admin': 'مدير',
  'role.coach': 'مدرب',
  'role.player': 'لاعب',

  'belt.white': 'أبيض',
  'belt.blue': 'أزرق',
  'belt.purple': 'بنفسجي',
  'belt.brown': 'بني',
  'belt.black': 'أسود',

  'classType.gi': 'جي',
  'classType.nogi': 'نو جي',
  'classType.open_mat': 'أوبن مات',
  'classType.kids': 'أطفال',
  'classType.seminar': 'سمينار',

  'pay.title': 'الاشتراكات',
  'pay.outstanding': 'المتبقي',
  'pay.totalOutstanding': 'إجمالي المتبقي',
  'pay.lastPaid': 'آخر دفعة',
  'pay.never': 'ما في دفعات',
  'pay.collect': 'تحصيل دفعة',
  'pay.sell': 'بيع اشتراك',
  'pay.plan': 'الخطة',
  'pay.amount': 'المبلغ',
  'pay.method': 'طريقة الدفع',
  'pay.payNow': 'دُفع الآن',
  'pay.backfill': 'احسب الحصص غير المدفوعة السابقة',
  'pay.record': 'تسجيل',
  'pay.note': 'ملاحظة',
  'pay.date': 'التاريخ',
  'pay.purchases': 'الاشتراكات المشتراة',
  'pay.payments': 'الدفعات',
  'pay.coverage': 'التغطية الحالية',
  'pay.sessionsLeft': '{n} حصة متبقية',
  'pay.unlimited': 'غير محدود',
  'pay.validUntil': 'حتى {date}',
  'pay.noExpiry': 'بدون انتهاء',
  'pay.paidOf': 'دُفع {paid} من {total}',
  'pay.cancel': 'إلغاء الاشتراك',
  'pay.cancelConfirm': 'إلغاء هذا الاشتراك؟ الحصص المرتبطة به ترجع غير مدفوعة.',
  'pay.settled': 'ما في مبالغ متبقية',
  'pay.uncoveredClasses': '{n} حصة غير مدفوعة',
  'pay.noOutstanding': 'كل اللاعبين مسدّدين.',
  'pay.backfilled': 'تمت تغطية {n} حصة سابقة',

  'coverage.monthly': 'اشتراك شهري',
  'coverage.package': 'بطاقة حصص',
  'coverage.single': 'حصة مفردة',
  'coverage.free': 'مجانًا',
  'coverage.uncovered': 'غير مدفوعة',

  'method.cash': 'نقدًا',
  'method.bank': 'تحويل بنكي',
  'method.wallet': 'محفظة إلكترونية',
  'method.other': 'أخرى',

  'planType.monthly': 'شهري',
  'planType.package': 'بطاقة حصص',
  'planType.single': 'حصة مفردة',

  'promo.title': 'الترقيات',
  'promo.board': 'لوحة الاستحقاق',
  'promo.award': 'ترقية',
  'promo.awardTo': 'ترقية إلى {target}',
  'promo.confirm': 'تأكيد الترقية',
  'promo.undo': 'إلغاء آخر ترقية',
  'promo.undoConfirm': 'إلغاء آخر ترقية لهذا اللاعب؟',
  'promo.nextStripe': 'خط {n}',
  'promo.nextBelt': 'حزام {belt}',
  'promo.eligibleOn': 'يستحق في {date}',
  'promo.eligibleSince': 'مستحق من {date}',
  'promo.monthsServed': '{done} من {need} شهر',
  'promo.classesDone': '{done} من {need} حصة',
  'promo.shortBy': 'ناقص {n} حصة',
  'promo.daysLeft': 'باقي {n} يوم',
  'promo.overrideTitle': 'الاستحقاق غير مكتمل',
  'promo.overrideBody': 'المدة أو الحضور ما كملوا الشرط. تقدر ترقّيه على كل حال، وبنسجل إنها ترقية باستثناء.',
  'promo.overrideConfirm': 'ترقية على كل حال',
  'promo.awardedBy': 'بإشراف',
  'promo.rules': 'شروط الترقية',
  'promo.monthsPerStripe': 'أشهر لكل خط',
  'promo.classesPerStripe': 'حصص لكل خط',
  'promo.monthsToBelt': 'أشهر للحزام التالي',
  'promo.classesToBelt': 'حصص للحزام التالي',
  'promo.minAge': 'أصغر عمر',
  'promo.maxStripes': 'أقصى عدد خطوط',
  'promo.noneDue': 'ما في ترقيات مستحقة حاليًا.',
  'promo.progress': 'التقدم',
  'promo.rulesHint': 'الشرطان لازم يكتملا: المدة والحضور. الشيت القديم كان يحسب المدة بس.',

  'promoStatus.due': 'مستحق',
  'promoStatus.overdue': 'متأخر',
  'promoStatus.upcoming': 'قريبًا',
  'promoStatus.blocked_attendance': 'ينقصه حضور',
  'promoStatus.blocked_age': 'العمر أصغر',
  'promoStatus.inactive': 'غير نشط',
  'promoStatus.capped': 'أعلى درجة',
  'promoStatus.not_due': 'غير مستحق',

  'settings.title': 'الإعدادات',
  'settings.team': 'الفريق',
  'settings.teamName': 'اسم الفريق',
  'settings.currency': 'العملة',
  'settings.timezone': 'المنطقة الزمنية',
  'settings.lookahead': 'أيام التنبيه المسبق للترقية',
  'settings.plans': 'الخطط والأسعار',
  'settings.planName': 'اسم الخطة',
  'settings.planPrice': 'السعر',
  'settings.planSessions': 'عدد الحصص',
  'settings.planValidity': 'مدة الصلاحية (أيام)',
  'settings.planActive': 'مفعّلة',
  'settings.addPlan': 'إضافة خطة',
  'settings.placeholderPrices': 'الأسعار الحالية مبدئية — عدّلها قبل الاستخدام الفعلي.',
  'settings.language': 'اللغة',
  'settings.theme': 'المظهر',
  'settings.theme.system': 'حسب النظام',
  'settings.theme.light': 'فاتح',
  'settings.theme.dark': 'غامق',
  'settings.logout': 'خروج',
  'settings.audit': 'سجل العمليات',

  'me.title': 'ملفي',
  'me.nextPromotion': 'الترقية القادمة',
  'me.myAttendance': 'حضوري',
  'me.myBalance': 'حسابي',
  'me.whatWeTrained': 'شو تدربنا',
  'me.attended': 'حضرت',
  'me.missed': 'ما حضرت',
  'me.noTechniques': 'ما في تكنيكات مسجّلة بعد.',
  'me.owes': 'عليك {amount}',
  'me.clear': 'حسابك مسدّد',
  'me.classesTotal': 'إجمالي الحصص',
  'me.sinceLastPromotion': 'منذ آخر ترقية',

  'chart.monthlyAttendance': 'الحضور الشهري',
  'chart.classes': 'حصة',
  'chart.earlier': 'ما قبل 2026',
  'chart.noData': 'ما في بيانات حضور.',
  'chart.showTable': 'اعرض كجدول',
  'chart.hideTable': 'أخفِ الجدول',
  'chart.month': 'الشهر',

  'common.cancel': 'إلغاء',
  'common.confirm': 'تأكيد',
  'common.save': 'حفظ',
  'common.saving': 'جارٍ الحفظ…',
  'common.close': 'إغلاق',
  'common.delete': 'حذف',
  'common.back': 'رجوع',
  'common.loading': 'جارٍ التحميل…',
  'common.retry': 'إعادة المحاولة',
  'common.none': '—',
  'common.optional': 'اختياري',
  'common.today': 'اليوم',
  'common.of': 'من',
  'common.yes': 'نعم',
  'common.no': 'لا',
  'common.more': 'المزيد',

  'err.generic': 'صار خطأ. جرّب مرة ثانية.',
  'err.network': 'ما في اتصال بالشبكة.',
  'err.invalid_credentials': 'رقم الجوال أو الرمز غير صحيح.',
  'err.account_disabled': 'هذا الحساب موقوف.',
  'err.locked': 'تم إيقاف المحاولات مؤقتًا بعد محاولات خاطئة. جرّب بعد شوي.',
  'err.current_pin_wrong': 'الرمز الحالي غير صحيح.',
  'err.pin_too_short': 'الرمز قصير — الحد الأدنى {n} خانات.',
  'err.pin_all_same_digit': 'لا تستخدم رمزًا بنفس الرقم المتكرر.',
  'err.pin_sequential': 'لا تستخدم رمزًا متسلسلًا.',
  'err.pin_unchanged': 'الرمز الجديد نفس القديم.',
  'err.forbidden': 'ما عندك صلاحية لهذا الإجراء.',
  'err.login_taken': 'رقم الجوال مستخدم لحساب ثاني.',
  'err.phone_required_for_login': 'لازم رقم جوال قبل إنشاء حساب الدخول.',
  'err.bad_phone': 'رقم الجوال غير صحيح.',
  'err.bad_amount': 'المبلغ غير صحيح.',
  'err.member_not_found': 'اللاعب غير موجود.',
  'err.no_change': 'ما في تغيير.',
} as const;

type Key = keyof typeof ar;

const en: Record<Key, string> = {
  'app.name': 'JUI-Jitsu',
  'app.tagline': 'Attendance, payments and promotions',

  'nav.home': 'Home',
  'nav.classes': 'Classes',
  'nav.members': 'Members',
  'nav.payments': 'Payments',
  'nav.promotions': 'Promotions',
  'nav.settings': 'Settings',
  'nav.me': 'My profile',

  'login.title': 'Sign in',
  'login.phone': 'Phone number',
  'login.pin': 'PIN',
  'login.submit': 'Sign in',
  'login.working': 'Signing in…',
  'login.hint': 'Forgotten your PIN? Ask your coach to reset it.',

  'pin.title': 'Choose a new PIN',
  'pin.why': 'This is your first sign-in, so the temporary PIN must be changed.',
  'pin.current': 'Current PIN',
  'pin.new': 'New PIN',
  'pin.confirm': 'Confirm new PIN',
  'pin.submit': 'Save PIN',
  'pin.mismatch': 'The two PINs do not match.',

  'dash.title': 'Overview',
  'dash.activeMembers': 'Active members',
  'dash.classesThisMonth': 'Classes this month',
  'dash.checkinsThisMonth': 'Check-ins this month',
  'dash.collected': 'Collected this month',
  'dash.outstanding': 'Outstanding',
  'dash.membersOwing': '{n} members owe money',
  'dash.promotionsDue': 'Promotions due',
  'dash.blockedByAttendance': '{n} short on attendance',
  'dash.uncovered': 'Unpaid classes',
  'dash.lastClass': 'Last class',
  'dash.noClasses': 'No classes recorded yet.',
  'dash.startClass': "Start today's class",
  'dash.openClass': 'Open class',
  'dash.quickActions': 'Quick actions',

  'classes.title': 'Classes',
  'classes.new': 'New class',
  'classes.date': 'Date',
  'classes.time': 'Time',
  'classes.type': 'Class type',
  'classes.technique': 'Technique',
  'classes.techniquePlaceholder': 'e.g. guard passing — knee slice',
  'classes.notes': 'Class notes',
  'classes.create': 'Create class',
  'classes.present': 'present',
  'classes.attendees': 'recorded',
  'classes.empty': 'No classes in this period.',
  'classes.close': 'Close class',
  'classes.reopen': 'Reopen class',
  'classes.closed': 'Closed',

  'checkin.title': 'Check-in',
  'checkin.save': 'Save attendance',
  'checkin.saving': 'Saving…',
  'checkin.saved': 'Attendance saved',
  'checkin.allPresent': 'All present',
  'checkin.clear': 'Clear all',
  'checkin.search': 'Find a member',
  'checkin.unsaved': '{n} unsaved changes',
  'checkin.pendingSync': 'Saved on this device — will sync when back online',
  'checkin.offline': 'Offline',
  'checkin.charge': 'Take payment',
  'checkin.presentCount': '{n} of {total} present',

  'att.present': 'Present',
  'att.absent': 'Absent',
  'att.late': 'Late',
  'att.excused': 'Excused',

  'members.title': 'Members',
  'members.new': 'New member',
  'members.search': 'Search by name or phone',
  'members.all': 'All',
  'members.empty': 'No members match.',
  'members.classes': 'classes',
  'members.noPhone': 'No phone',
  'members.noLogin': 'No account',
  'members.createLogin': 'Create login',
  'members.resetPin': 'Reset PIN',
  'members.removeLogin': 'Remove login',
  'members.pinIssued': 'Temporary PIN — write it down now, it is not shown again',
  'members.pinIssuedFor': 'Temporary PIN for {name}',
  'members.copyPin': 'Copy',
  'members.copied': 'Copied',
  'members.role': 'Role',
  'members.name': 'Name',
  'members.phone': 'Phone number',
  'members.birthDate': 'Date of birth',
  'members.joinDate': 'Joined',
  'members.notes': 'Notes',
  'members.save': 'Save',
  'members.belt': 'Belt',
  'members.stripes': 'Stripes',
  'members.lastPromotion': 'Last promotion',
  'members.totalClasses': 'Total classes',
  'members.status': 'Status',
  'members.profile': 'Member profile',
  'members.history': 'Monthly attendance',
  'members.beltHistory': 'Belt history',
  'members.recentAttendance': 'Recent classes',
  'members.deleteLoginConfirm': 'Remove this member’s login?',
  'members.imported': 'Imported from the sheet',

  'status.active': 'Active',
  'status.inactive': 'Inactive',
  'status.paused': 'Paused',

  'role.admin': 'Admin',
  'role.coach': 'Coach',
  'role.player': 'Player',

  'belt.white': 'White',
  'belt.blue': 'Blue',
  'belt.purple': 'Purple',
  'belt.brown': 'Brown',
  'belt.black': 'Black',

  'classType.gi': 'Gi',
  'classType.nogi': 'No-gi',
  'classType.open_mat': 'Open mat',
  'classType.kids': 'Kids',
  'classType.seminar': 'Seminar',

  'pay.title': 'Payments',
  'pay.outstanding': 'Outstanding',
  'pay.totalOutstanding': 'Total outstanding',
  'pay.lastPaid': 'Last payment',
  'pay.never': 'No payments',
  'pay.collect': 'Take a payment',
  'pay.sell': 'Sell a plan',
  'pay.plan': 'Plan',
  'pay.amount': 'Amount',
  'pay.method': 'Method',
  'pay.payNow': 'Paid now',
  'pay.backfill': 'Apply to earlier unpaid classes',
  'pay.record': 'Record',
  'pay.note': 'Note',
  'pay.date': 'Date',
  'pay.purchases': 'Plans bought',
  'pay.payments': 'Payments',
  'pay.coverage': 'Current coverage',
  'pay.sessionsLeft': '{n} sessions left',
  'pay.unlimited': 'Unlimited',
  'pay.validUntil': 'until {date}',
  'pay.noExpiry': 'No expiry',
  'pay.paidOf': '{paid} paid of {total}',
  'pay.cancel': 'Cancel plan',
  'pay.cancelConfirm': 'Cancel this plan? Classes it paid for go back to unpaid.',
  'pay.settled': 'Nothing outstanding',
  'pay.uncoveredClasses': '{n} unpaid classes',
  'pay.noOutstanding': 'Everyone is settled up.',
  'pay.backfilled': 'Covered {n} earlier classes',

  'coverage.monthly': 'Monthly subscription',
  'coverage.package': 'Session card',
  'coverage.single': 'Single session',
  'coverage.free': 'Free',
  'coverage.uncovered': 'Unpaid',

  'method.cash': 'Cash',
  'method.bank': 'Bank transfer',
  'method.wallet': 'Mobile wallet',
  'method.other': 'Other',

  'planType.monthly': 'Monthly',
  'planType.package': 'Session card',
  'planType.single': 'Single session',

  'promo.title': 'Promotions',
  'promo.board': 'Eligibility board',
  'promo.award': 'Promote',
  'promo.awardTo': 'Promote to {target}',
  'promo.confirm': 'Confirm promotion',
  'promo.undo': 'Undo last promotion',
  'promo.undoConfirm': 'Undo this member’s last promotion?',
  'promo.nextStripe': 'stripe {n}',
  'promo.nextBelt': '{belt} belt',
  'promo.eligibleOn': 'Eligible on {date}',
  'promo.eligibleSince': 'Eligible since {date}',
  'promo.monthsServed': '{done} of {need} months',
  'promo.classesDone': '{done} of {need} classes',
  'promo.shortBy': 'Short {n} classes',
  'promo.daysLeft': '{n} days to go',
  'promo.overrideTitle': 'Not yet eligible',
  'promo.overrideBody':
    'Time served or attendance has not met the rule. You can promote anyway, and it is recorded as an exception.',
  'promo.overrideConfirm': 'Promote anyway',
  'promo.awardedBy': 'Awarded by',
  'promo.rules': 'Promotion rules',
  'promo.monthsPerStripe': 'Months per stripe',
  'promo.classesPerStripe': 'Classes per stripe',
  'promo.monthsToBelt': 'Months to next belt',
  'promo.classesToBelt': 'Classes to next belt',
  'promo.minAge': 'Minimum age',
  'promo.maxStripes': 'Max stripes',
  'promo.noneDue': 'No promotions are due right now.',
  'promo.progress': 'Progress',
  'promo.rulesHint': 'Both gates must be met: time and attendance. The old sheet checked time only.',

  'promoStatus.due': 'Due',
  'promoStatus.overdue': 'Overdue',
  'promoStatus.upcoming': 'Coming up',
  'promoStatus.blocked_attendance': 'Short on attendance',
  'promoStatus.blocked_age': 'Too young',
  'promoStatus.inactive': 'Inactive',
  'promoStatus.capped': 'Top grade',
  'promoStatus.not_due': 'Not due',

  'settings.title': 'Settings',
  'settings.team': 'Team',
  'settings.teamName': 'Team name',
  'settings.currency': 'Currency',
  'settings.timezone': 'Time zone',
  'settings.lookahead': 'Promotion look-ahead (days)',
  'settings.plans': 'Plans and prices',
  'settings.planName': 'Plan name',
  'settings.planPrice': 'Price',
  'settings.planSessions': 'Sessions',
  'settings.planValidity': 'Validity (days)',
  'settings.planActive': 'Active',
  'settings.addPlan': 'Add plan',
  'settings.placeholderPrices': 'Prices are placeholders — set the real ones before using this.',
  'settings.language': 'Language',
  'settings.theme': 'Appearance',
  'settings.theme.system': 'System',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.logout': 'Sign out',
  'settings.audit': 'Activity log',

  'me.title': 'My profile',
  'me.nextPromotion': 'Next promotion',
  'me.myAttendance': 'My attendance',
  'me.myBalance': 'My account',
  'me.whatWeTrained': 'What we trained',
  'me.attended': 'Attended',
  'me.missed': 'Missed',
  'me.noTechniques': 'No techniques recorded yet.',
  'me.owes': 'You owe {amount}',
  'me.clear': 'Your account is settled',
  'me.classesTotal': 'Total classes',
  'me.sinceLastPromotion': 'Since last promotion',

  'chart.monthlyAttendance': 'Monthly attendance',
  'chart.classes': 'classes',
  'chart.earlier': 'Before 2026',
  'chart.noData': 'No attendance data.',
  'chart.showTable': 'Show as table',
  'chart.hideTable': 'Hide table',
  'chart.month': 'Month',

  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.save': 'Save',
  'common.saving': 'Saving…',
  'common.close': 'Close',
  'common.delete': 'Delete',
  'common.back': 'Back',
  'common.loading': 'Loading…',
  'common.retry': 'Retry',
  'common.none': '—',
  'common.optional': 'optional',
  'common.today': 'Today',
  'common.of': 'of',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.more': 'More',

  'err.generic': 'Something went wrong. Try again.',
  'err.network': 'No network connection.',
  'err.invalid_credentials': 'Wrong phone number or PIN.',
  'err.account_disabled': 'This account is disabled.',
  'err.locked': 'Too many wrong attempts. Try again shortly.',
  'err.current_pin_wrong': 'Current PIN is wrong.',
  'err.pin_too_short': 'PIN too short — minimum {n} digits.',
  'err.pin_all_same_digit': 'Do not use the same digit repeated.',
  'err.pin_sequential': 'Do not use a sequential PIN.',
  'err.pin_unchanged': 'New PIN is the same as the old one.',
  'err.forbidden': 'You do not have permission for that.',
  'err.login_taken': 'That phone number belongs to another account.',
  'err.phone_required_for_login': 'A phone number is needed before creating a login.',
  'err.bad_phone': 'That phone number is not valid.',
  'err.bad_amount': 'That amount is not valid.',
  'err.member_not_found': 'Member not found.',
  'err.no_change': 'Nothing changed.',
};

export type Lang = 'ar' | 'en';
const DICTS: Record<Lang, Record<Key, string>> = { ar, en };

export type Translate = (key: Key, vars?: Record<string, string | number>) => string;

interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Translate;
  dir: 'rtl' | 'ltr';
}

const LangContext = createContext<LangContextValue | null>(null);

const STORAGE_KEY = 'jj.lang';

function readStored(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'ar' || v === 'en') return v;
  } catch {
    // Private mode or blocked storage: Arabic is the right default anyway.
  }
  return 'ar';
}

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStored);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisting a language preference is survivable.
    }
  }, []);

  const t = useCallback<Translate>(
    (key, vars) => {
      let out: string = DICTS[lang][key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          out = out.replaceAll(`{${k}}`, String(v));
        }
      }
      return out;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t, dir }), [lang, setLang, t, dir]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used inside LangProvider');
  return ctx;
}

export function useT(): Translate {
  return useLang().t;
}

// Typed helpers so an enum value from the API never leaks into the UI raw.
export const beltKey = (b: Belt) => `belt.${b}` as Key;
export const statusKey = (s: MemberStatus) => `status.${s}` as Key;
export const coverageKey = (c: Coverage) => `coverage.${c}` as Key;
export const methodKey = (m: PaymentMethod) => `method.${m}` as Key;
export const planTypeKey = (p: PlanType) => `planType.${p}` as Key;
export const promoStatusKey = (s: PromotionStatus) => `promoStatus.${s}` as Key;
