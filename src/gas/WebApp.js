/**
 * 웹앱 진입점 + 공통 API (부트스트랩, 대시보드, 달력, 날짜 상세, 로그, 인쇄).
 * 모든 api* 는 첫 인자 token, 첫 줄 requireSession(token). 예외: apiLogin/apiCheckSession/apiLogout.
 */

/** 웹앱 진입점 (GET 요청): ui/index 템플릿을 렌더링. 이때 확인된 배포 URL/ID 를 기록해 둔다 */
function doGet(e) {
  try { recordWebAppUrl_(true); } catch (err) { /* 무시 */ }
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

/** 학생 객체 → 웹앱 전송용 plain 객체 (알레르기명·라벨 등 표시용 필드를 미리 계산해 붙임) */
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

/** 급식 메뉴 한 개 → 웹앱 전송용 plain 객체 */
function serializeMenu_(m) {
  return {
    _row: m._row || null, date: m.date, mealType: m.mealType, name: m.name, codes: m.codes, codeNames: allergenNames(m.codes),
    needsCheck: m.needsCheck, checkedNone: m.checkedNone, source: m.source, manualEdited: m.manualEdited, raw: m.raw, checkedAt: m.checkedAt || '',
  };
}

/** 한 끼 판별 결과(checkMeal) → 메뉴 목록 + 해당 학생별 원인(메뉴·코드·키워드) 텍스트로 직렬화 */
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

/** 설정 중 정의된 키만 골라 웹앱에 노출 (비밀값은 여기 포함되지 않음) */
function publicSettings_(settings) {
  var out = {};
  SETTING_KEYS.forEach(function (k) {
    out[k] = SETTING_BOOL_KEYS.indexOf(k) >= 0 ? toBool(settings[k], false) : String(settings[k] === undefined ? '' : settings[k]);
  });
  return out;
}

// ---------- 부트스트랩 ----------

/** 웹앱: 화면 공통 정보 (설정, 비밀값 설정 여부, 채널 상태, 트리거 목록, 이메일 잔여 한도 등) */
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
    keywordList: parseKeywordList(settings['기타알레르기목록']),
    webAppUrl: webAppUrl_(settings),
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

/** 웹앱: 대시보드 데이터 (오늘 판별 + 주간 요약 + 최근 실패 로그 + 동기화 상태) */
function apiDashboard(token) {
  requireSession(token);
  var today = todayStr_();
  // 판별 결과는 캐시(학생/급식/설정 변경 시 즉시 무효화), 로그·동기화 상태는 매번 최신
  var core = cached_('dashboard:' + today, function () { return _buildDashboardCore(today); });
  core.failures = _recentFailures(5);
  core.lastSync = lastSyncInfo_();
  core.schoolConfigured = !!(core.schoolCode && hasSecret('NEIS_API_KEY'));
  return core;
}

/**
 * 대시보드에 보여줄 최근 실패 로그.
 * "숨기기"(FAILURES_DISMISSED_AT) 이후에 생긴 것, 그리고 최근 7일 이내 것만.
 */
function _recentFailures(limit) {
  var dismissedAt = getState('FAILURES_DISMISSED_AT');
  var since = Utilities.formatDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), 'Asia/Seoul', 'yyyy-MM-dd');
  return readLogs_(100).filter(function (l) {
    if (l.ok === true || l.ok === 'TRUE') return false;
    var at = String(l.sentAt);
    return at.slice(0, 10) >= since && (!dismissedAt || at > dismissedAt);
  }).slice(0, limit)
    .map(function (l) { return { sentAt: String(l.sentAt), kind: l.kind, channel: l.channel, error: l.error, summary: l.summary }; });
}

/** 현재까지의 실패 알림을 대시보드에서 숨긴다 (로그는 그대로, 새 실패는 다시 표시) */
function apiDismissFailures(token) {
  requireSession(token);
  setState('FAILURES_DISMISSED_AT', nowStr_());
  return { ok: true };
}

/** 대시보드에서 캐시되는 부분: 오늘 끼니별 판별, 이번 주 날짜별 요약, 이번 달 미확인 메뉴 수 */
function _buildDashboardCore(today) {
  var settings = readSettings();
  var mealTypes = managedMealTypes_(settings);
  var allStudents = readStudents_();
  // 달력/날짜 상세(apiMonth/apiDay)와 같은 학생 집합을 써야 담임 표시·기타 키워드 동의어가 대시보드에서도 일치한다
  var students = readActiveStudents_(settings);
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

/** 웹앱: 달력용 한 달치 날짜별 요약 (캐시됨) */
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

/** 웹앱: 특정 날짜의 끼니별 상세 판별 결과 (캐시됨) */
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

// ---------- 학생별 월간 현황 ----------

/**
 * 웹앱: 학생 1명의 한 달 판별 결과 (캐시됨).
 * 비활성·지난 학년도 학생도 열 수 있도록 전체 학생에서 찾되, 판별 규칙(담임·키워드 동의어)은 활성 학생과 같게 붙인다.
 * @returns { ym, start, end, mealTypes, student, mealDates: [date], days: [{ date, meals: [{ mealType, items: [{menu, reasons, matchedCodes, matchedKeywords, text}], text }] }] }
 */
function apiStudentMonth(token, row, ym) {
  requireSession(token);
  row = Number(row);
  if (!row) throw new Error('학생 행 번호 오류');
  if (!/^\d{4}-\d{2}$/.test(ym || '')) throw new Error('월 형식 오류');
  return cached_('studentMonth:' + row + ':' + ym, function () {
    var settings = readSettings();
    var mealTypes = managedMealTypes_(settings);
    var st = readStudents_().filter(function (s) { return Number(s._row) === row; })[0];
    if (!st) throw new Error('학생을 찾을 수 없습니다 (행 ' + row + ')');
    st = expandStudentKeywords(attachTeachers([st], teacherMap_(settings)), parseKeywordList(settings['기타알레르기목록']))[0];
    var range = monthRange(ym);
    var meals = readMealsInRange_(range.start, range.end, mealTypes);
    var mealDates = {};
    meals.forEach(function (m) { mealDates[m.date] = true; });
    var days = calcStudentDays(checkPeriod([st], meals, mealTypes)).map(function (d) {
      return { date: d.date, meals: d.meals.map(function (m) {
        return { mealType: m.mealType, text: m.items.map(formatAffectedItem).join(', '), items: m.items.map(function (it) {
          return { menu: it.menu.name, matchedCodes: it.matchedCodes, matchedKeywords: it.matchedKeywords,
            reasons: allergenNames(it.matchedCodes).concat(it.matchedKeywords), text: formatAffectedItem(it) };
        }) };
      }) };
    });
    return { ym: ym, start: range.start, end: range.end, mealTypes: mealTypes, student: serializeStudent_(st),
      mealDates: Object.keys(mealDates).sort(), days: days };
  });
}

// ---------- 로그 ----------

/** 웹앱: 최근 알림로그 목록. opts.failedOnly 로 실패 건만 필터 */
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
  // 날짜×끼니 판별 결과를 학급(학년-반) 단위로 다시 묶는다 — 인쇄물이 반별로 배부되기 때문
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
