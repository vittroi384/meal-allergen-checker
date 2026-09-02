/**
 * 설정 API: 설정 저장, 비밀값, 학교 검색, 채널 테스트, 알림 테스트/미리보기.
 * 모두 'admin' 레벨 — 인증 모드 'settings' 에서도 잠긴다.
 */

// 값이 바뀌면 시간 기반 트리거를 다시 등록해야 하는 설정 키
var _TRIGGER_TIME_KEYS = ['담당자알림시간', '학부모알림시간'];

/** 설정 부분 저장(웹앱). 시간·끼니 값을 검증하고, 알림 시간이 바뀌면 트리거를 재등록. 최신 전체 상태(apiBootstrap)를 반환. */
function apiSaveSettings(token, partial) {
  requireSession(token, 'admin');
  var p = partial || {};
  _TRIGGER_TIME_KEYS.forEach(function (k) {
    if (k in p && !parseTimeHHmm(p[k])) throw new Error(k + ' 형식은 HH:mm 이어야 합니다 (예: 07:30)');
  });
  if ('관리할끼니' in p) {
    var types = splitList(p['관리할끼니']).filter(function (t) { return MEAL_TYPES.indexOf(t) >= 0; });
    if (!types.length) throw new Error('관리할 끼니를 하나 이상 선택하세요');
    p['관리할끼니'] = types.join(',');
  }
  var before = readSettings();
  writeSettings(p);
  // 알림 시간이 실제로 바뀐 경우에만 트리거 재설치 (불필요한 트리거 재생성 방지)
  var timeChanged = _TRIGGER_TIME_KEYS.some(function (k) { return k in p && String(p[k]) !== String(before[k]); });
  if (timeChanged) setupTriggers_(readSettings());
  return apiBootstrap(token);
}

/** 비밀값 저장. NEIS 키는 유효성 검사 후 저장. 값이 비어 있으면 무시(삭제는 apiClearSecret). */
function apiSaveSecrets(token, secrets) {
  requireSession(token, 'admin');
  var s = secrets || {};
  var results = {};
  Object.keys(s).forEach(function (k) {
    // 허용된 비밀값 키만, 접속 비밀번호(APP_PASSWORD_*)는 전용 API(apiChangePassword)로만 변경
    if (SECRET_KEYS.indexOf(k) < 0 || k.indexOf('APP_PASSWORD') === 0) return;
    var v = String(s[k] || '').trim();
    if (!v) return;
    // NEIS 키는 실제 API 를 한 번 호출해 유효한 키인지 확인한 뒤에만 저장
    if (k === 'NEIS_API_KEY') {
      var t;
      try { t = testNeisKey_(v); } catch (e) { t = { ok: false, error: String(e.message || e) }; }
      if (!t.ok) { results[k] = { ok: false, error: 'NEIS 인증키 확인 실패: ' + t.error }; return; }
    }
    setSecret(k, v);
    results[k] = { ok: true };
  });
  return { results: results, secretStatus: getSecretStatus(), channels: channelStatus_(readSettings()) };
}

/** 비밀값 1개 삭제(웹앱). 접속 비밀번호 계열은 삭제 불가. */
function apiClearSecret(token, key) {
  requireSession(token, 'admin');
  if (SECRET_KEYS.indexOf(key) < 0 || key.indexOf('APP_PASSWORD') === 0) throw new Error('삭제할 수 없는 키');
  setSecret(key, '');
  return { secretStatus: getSecretStatus(), channels: channelStatus_(readSettings()) };
}

/** 학교명으로 NEIS 학교 검색(웹앱, 설정 화면). @returns { ok, error, schools } */
function apiSearchSchools(token, name) {
  requireSession(token, 'admin');
  return searchSchools_(name);
}

/** 검색 결과에서 고른 학교를 설정 시트에 저장(웹앱). */
function apiSetSchool(token, school) {
  requireSession(token, 'admin');
  if (!school || !school.atptCode || !school.schoolCode) throw new Error('학교 정보가 올바르지 않습니다');
  writeSettings({ '학교명': school.name || '', '시도교육청코드': school.atptCode, '학교코드': school.schoolCode });
  return { ok: true };
}

/** 알림 채널(이메일/문자/텔레그램) 테스트 발송(웹앱, 설정 화면 버튼). */
function apiTestChannel(token, channelId, to) {
  requireSession(token, 'admin');
  return sendTestNotice_(channelId, to);
}

/** 텔레그램 봇이 최근 받은 대화 목록 조회(웹앱). chat id 를 쉽게 찾도록 돕는다. */
function apiTelegramChats(token) {
  requireSession(token, 'admin');
  return telegramRecentChats_();
}

/** 담당자 알림 테스트 (실제 담당자에게 발송, 종류=테스트) */
function apiSendTestNotice(token, kind) {
  requireSession(token, 'admin');
  if (kind === 'weekly') return runStaffWeekly_({ force: true, test: true });
  return runStaffDaily_({ force: true, test: true });
}

/** 학부모 알림 미리보기 — 발송하지 않음 */
function apiPreviewParentNotices(token) {
  requireSession(token, 'admin');
  var settings = readSettings();
  var plan = planParentNotices_(settings, todayStr_());
  return {
    enabled: settingBool_(settings, '학부모알림사용'),
    target: plan.target, targetLabel: plan.target ? formatKoreanDate(plan.target) : '', reason: plan.reason,
    items: plan.items.map(function (it) {
      return { student: formatStudentLabel(it.student), mealType: it.mealType, channel: it.channel === 'sms' ? '문자' : '이메일',
        to: maskRecipient(it.to), text: it.text, fallback: it.fallback, error: it.error, bytes: calcSmsBytes(it.text) };
    }),
  };
}

/** 트리거 재등록 (설정 화면 버튼) */
function apiReinstallTriggers(token) {
  requireSession(token, 'admin');
  var n = setupTriggers_(readSettings());
  return { ok: true, count: n, triggers: listOurTriggers_() };
}
