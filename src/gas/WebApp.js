/**
 * 웹앱 진입점 + 공통 API (부트스트랩, 대시보드, 달력, 날짜 상세, 로그, 인쇄).
 * 모든 api* 는 첫 인자 token, 첫 줄 requireSession(token). 예외: apiLogin/apiCheckSession/apiLogout.
 */

function doGet(e) {
  try {
    var url = ScriptApp.getService().getUrl();
    if (url && getState('WEBAPP_URL') !== url) {
      setState('WEBAPP_URL', url);
      writeSettings({ '웹앱URL': url });
    }
  } catch (err) { /* 무시 */ }
  var t = HtmlService.createTemplateFromFile('ui/index');
  t.schoolName = '';
  try { t.schoolName = readSettings()['학교명'] || ''; } catch (err) { /* 초기 설정 전 */ }
  return t.evaluate()
    .setTitle('급식 알레르기 판별')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** 템플릿에서 <?!= include('ui/styles.css') ?> */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// ---------- 직렬화 (google.script.run 은 plain 객체만) ----------

function serializeStudent_(s) {
  var out = {
    _row: s._row || null, schoolYear: s.schoolYear, grade: s.grade, classNo: s.classNo, name: s.name,
    teacherName: s.teacherName || '', teacherPhone: s.teacherPhone || '',
    label: formatStudentLabel(s), codes: s.codes, codeNames: allergenNames(s.codes), keywords: s.keywords, note: s.note,
    parentEmail: s.parentEmail, parentPhone: s.parentPhone, parentNotify: s.parentNotify, active: s.active !== false,
  };
  if (s.teacher !== undefined) {
    out.teacher = s.teacher ? { name: s.teacher.name, phone: s.teacher.phone, conflict: !!s.teacher.conflict } : null;
    out.teacherLabel = formatTeacherShort(s.teacher);
  }
  return out;
}

function serializeMenu_(m) {
  return {
    _row: m._row || null, date: m.date, mealType: m.mealType, name: m.name, codes: m.codes, codeNames: allergenNames(m.codes),
    needsCheck: m.needsCheck, checkedNone: m.checkedNone, source: m.source, manualEdited: m.manualEdited, raw: m.raw,
  };
}

function serializeMealResult_(r) {
  return {
    menus: r.menus.map(serializeMenu_),
    affected: r.affected.map(function (a) {
      return {
        student: serializeStudent_(a.student),
        items: a.items.map(function (it) {
          return { menu: it.menu.name, menuRow: it.menu._row || null, matchedCodes: it.matchedCodes, matchedKeywords: it.matchedKeywords,
            reasons: allergenNames(it.matchedCodes).concat(it.matchedKeywords), text: formatAffectedItem(it) };
        }),
        text: a.items.map(formatAffectedItem).join(', '),
      };
    }),
    uncheckedMenus: r.uncheckedMenus,
    count: r.affected.length,
    protected: r.menus.some(function (m) { return m.manualEdited || m.source === SOURCES.MANUAL; }),
  };
}

function publicSettings_(settings) {
  var out = {};
  SETTING_KEYS.forEach(function (k) {
    out[k] = SETTING_BOOL_KEYS.indexOf(k) >= 0 ? toBool(settings[k], false) : String(settings[k] === undefined ? '' : settings[k]);
  });
  return out;
}

// ---------- 부트스트랩 ----------

function apiBootstrap(token) {
  requireSession(token);
  var settings = readSettings();
  return {
    today: todayStr_(),
    schoolYear: currentSchoolYear_(settings),
    settings: publicSettings_(settings),
    secretStatus: getSecretStatus(),
    channels: channelStatus_(settings),
    mealTypes: managedMealTypes_(settings),
    allMealTypes: MEAL_TYPES,
    allergens: ALLERGENS,
    webAppUrl: getState('WEBAPP_URL') || settings['웹앱URL'] || '',
    lastSync: lastSyncInfo_(),
    triggers: listOurTriggers_(),
    emailQuota: MailApp.getRemainingDailyQuota(),
  };
}

/** 로그인 직후 1회 호출: 부트스트랩 + 대시보드 + 이번 달 달력을 한 번에 */
function apiInit(token) {
  requireSession(token);
  var today = todayStr_();
  return { boot: apiBootstrap(token), dashboard: apiDashboard(token), month: apiMonth(token, yearMonthOf(today)) };
}

// ---------- 대시보드 ----------

function apiDashboard(token) {
  requireSession(token);
  var today = todayStr_();
  // 판별 결과는 캐시(학생/급식/설정 변경 시 즉시 무효화), 로그·동기화 상태는 매번 최신
  var core = cached_('dashboard:' + today, function () { return _buildDashboardCore(today); });
  core.failures = readLogs_(100).filter(function (l) { return l.ok !== true && l.ok !== 'TRUE'; }).slice(0, 5)
    .map(function (l) { return { sentAt: String(l.sentAt), kind: l.kind, channel: l.channel, error: l.error, summary: l.summary }; });
  core.lastSync = lastSyncInfo_();
  core.schoolConfigured = !!(core.schoolCode && hasSecret('NEIS_API_KEY'));
  return core;
}

function _buildDashboardCore(today) {
  var settings = readSettings();
  var mealTypes = managedMealTypes_(settings);
  var allStudents = readStudents_();
  var students = filterActiveStudents(allStudents, currentSchoolYear_(settings));
  var meals = readMeals_();

  var todayByType = {};
  mealTypes.forEach(function (t) {
    todayByType[t] = serializeMealResult_(checkMeal(students, meals.filter(function (m) { return m.date === today && m.mealType === t; })));
  });

  var wr = weekRange(today);
  var weekMeals = meals.filter(function (m) { return m.date >= wr.start && m.date <= wr.end && mealTypes.indexOf(m.mealType) >= 0; });
  var summaryByDate = {};
  summarizePeriod(checkPeriod(students, weekMeals, mealTypes)).forEach(function (s) { summaryByDate[s.date] = s; });
  var week = eachDay(wr.start, wr.end).map(function (d) {
    var s = summaryByDate[d];
    return { date: d, label: formatKoreanDate(d), isToday: d === today, hasMeals: !!s,
      affectedCount: s ? s.affectedCount : 0, uncheckedCount: s ? s.uncheckedCount : 0, manualProtected: s ? s.manualProtected : false };
  });

  var ym = yearMonthOf(today);
  var monthUnchecked = meals.filter(function (m) { return m.date.slice(0, 7) === ym && m.needsCheck && mealTypes.indexOf(m.mealType) >= 0; }).length;

  return {
    today: today, todayLabel: formatKoreanDateLong(today), mealTypes: mealTypes, todayByType: todayByType, week: week,
    monthUnchecked: monthUnchecked, studentCount: allStudents.length, activeStudentCount: students.length,
    schoolCode: String(settings['학교코드'] || ''),
  };
}

// ---------- 달력 / 날짜 ----------

function apiMonth(token, ym) {
  requireSession(token);
  if (!/^\d{4}-\d{2}$/.test(ym || '')) throw new Error('월 형식 오류');
  return cached_('month:' + ym, function () {
    var settings = readSettings();
    var mealTypes = managedMealTypes_(settings);
    var range = monthRange(ym);
    var students = readActiveStudents_(settings);
    var meals = readMealsInRange_(range.start, range.end, mealTypes);
    var days = summarizePeriod(checkPeriod(students, meals, mealTypes));
    return { ym: ym, start: range.start, end: range.end, days: days, mealTypes: mealTypes };
  });
}

function apiDay(token, date) {
  requireSession(token);
  if (!isValidDateStr(date)) throw new Error('날짜 형식 오류');
  return cached_('day:' + date, function () {
    var settings = readSettings();
    var mealTypes = managedMealTypes_(settings);
    var students = readActiveStudents_(settings);
    var meals = readMealsInRange_(date, date, MEAL_TYPES);
    var byType = {};
    mealTypes.forEach(function (t) {
      byType[t] = serializeMealResult_(checkMeal(students, meals.filter(function (m) { return m.mealType === t; })));
    });
    return { date: date, label: formatKoreanDateLong(date), mealTypes: mealTypes, byType: byType };
  });
}

// ---------- 로그 ----------

function apiLogs(token, opts) {
  requireSession(token);
  var o = opts || {};
  var rows = readLogs_(o.limit || 200);
  if (o.failedOnly) rows = rows.filter(function (l) { return l.ok !== true && l.ok !== 'TRUE'; });
  return rows.map(function (l) {
    return { sentAt: String(l.sentAt), channel: l.channel, kind: l.kind, recipient: l.recipient, targetDate: String(l.targetDate),
      summary: l.summary, ok: l.ok === true || l.ok === 'TRUE', error: l.error };
  });
}

// ---------- 인쇄용 (반별) ----------

/** @returns { start, end, classes: [{ grade, classNo, key, rows: [{date, label, mealType, student, text}] }] } */
function apiPrintData(token, params) {
  requireSession(token);
  var p = params || {};
  var start = p.start, end = p.end;
  if (!isValidDateStr(start) || !isValidDateStr(end) || start > end) throw new Error('기간이 올바르지 않습니다');
  if (eachDay(start, end).length > 62) throw new Error('기간은 최대 2개월까지 가능합니다');
  var settings = readSettings();
  var mealTypes = managedMealTypes_(settings);
  var students = readActiveStudents_(settings);
  var period = checkPeriod(students, readMealsInRange_(start, end, mealTypes), mealTypes);
  var byClass = {};
  Object.keys(period).forEach(function (date) {
    Object.keys(period[date]).forEach(function (t) {
      period[date][t].affected.forEach(function (a) {
        var st = a.student;
        if (p.grade && Number(p.grade) !== st.grade) return;
        if (p.classNo && Number(p.classNo) !== st.classNo) return;
        var key = st.grade + '-' + st.classNo;
        if (!byClass[key]) byClass[key] = { grade: st.grade, classNo: st.classNo, key: key, teacher: st.teacher || null, teacherLabel: formatTeacherShort(st.teacher), rows: [] };
        byClass[key].rows.push({ date: date, label: formatKoreanDate(date), mealType: t, student: formatStudentLabel(st),
          name: st.name, text: a.items.map(formatAffectedItem).join(', ') });
      });
    });
  });
  var classes = Object.keys(byClass).map(function (k) { return byClass[k]; })
    .sort(function (a, b) { return (a.grade - b.grade) || (a.classNo - b.classNo); });
  classes.forEach(function (c) { c.rows.sort(function (a, b) { return a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'ko'); }); });
  return { start: start, end: end, schoolName: settings['학교명'] || '', classes: classes };
}
