/**
 * 알림 오케스트레이션: 담당자 일일/주간, 학부모 전날, 동기화 결과, 테스트 발송.
 * 문구는 core/messages.js, 채널은 channels/*.js. 중복 발송은 알림로그의 중복키로 방지.
 */

// 학부모 발송 1회 실행 시간 상한 — Apps Script 6분 제한 전에 스스로 멈추고 다음 실행에서 이어간다
var _PARENT_TIME_BUDGET_MS = 5 * 60 * 1000;

/** 사용 가능한 알림 채널 객체 목록 (channels/*.js 에 정의). */
function allChannels_() {
  return [emailChannel_, smsChannel_, telegramChannel_];
}

/** 채널 id('email'|'sms'|'telegram') → 채널 객체, 없으면 null. */
function channelById_(id) {
  return allChannels_().filter(function (c) { return c.id === id; })[0] || null;
}

/** 채널 상태 (설정 화면·대시보드용) */
function channelStatus_(settings) {
  return allChannels_().map(function (c) {
    return { id: c.id, name: c.name, enabled: c.isEnabled(settings), reason: c.disabledReason ? c.disabledReason(settings) : '' };
  });
}

/**
 * 담당자 전원에게 발송 (이메일 1통 + 텔레그램 chat 마다).
 * @returns { sent: number, failed: number, skipped: number }
 */
function sendToStaff_(settings, kind, targetDate, msg, dedupeSuffix) {
  var out = { sent: 0, failed: 0, skipped: 0 };
  // 최근 14일 알림로그의 성공 중복키 — 같은 내용을 두 번 보내지 않기 위한 기준
  var done = readSuccessfulDedupeKeys_(addDays(todayStr_(), -14));
  var emails = settingList_(settings, '담당자이메일');
  var chats = settingList_(settings, '담당자텔레그램chatid');

  if (emailChannel_.isEnabled(settings) && emails.length) {
    var to = emails.join(',');
    var key = calcDedupeKey(kind, targetDate, to, dedupeSuffix || '');
    if (done[key]) {
      out.skipped++;
    } else {
      var r = emailChannel_.send({ to: to, subject: msg.subject, text: msg.text, html: msg.html });
      appendLog_({ channel: CHANNELS.EMAIL, kind: kind, recipient: to, targetDate: targetDate, summary: msg.subject, ok: r.ok, error: r.error, dedupeKey: key });
      r.ok ? out.sent++ : out.failed++;
    }
  }
  if (telegramChannel_.isEnabled(settings)) {
    chats.forEach(function (chat) {
      var key = calcDedupeKey(kind, targetDate, 'tg:' + chat, dedupeSuffix || '');
      if (done[key]) { out.skipped++; return; }
      var r = telegramChannel_.send({ to: chat, subject: msg.subject, text: msg.text });
      appendLog_({ channel: CHANNELS.TELEGRAM, kind: kind, recipient: 'tg:' + chat, targetDate: targetDate, summary: msg.subject, ok: r.ok, error: r.error, dedupeKey: key });
      r.ok ? out.sent++ : out.failed++;
    });
  }
  // 보낼 곳이 하나도 없으면 실패로 기록해 관리자가 알아차리게 한다
  if (!emails.length && !chats.length) {
    appendLog_({ kind: kind, targetDate: targetDate, summary: '담당자 연락처가 설정되지 않아 발송 못 함: ' + msg.subject, ok: false, error: '담당자이메일/텔레그램 chat id 없음' });
    out.failed++;
  }
  return out;
}

/** 특정 날짜의 끼니별 판별 결과 { 중식: checkMeal결과 } */
function checkDate_(date, settings) {
  var mealTypes = managedMealTypes_(settings);
  var students = readActiveStudents_(settings);
  var menus = readMealsInRange_(date, date, mealTypes);
  var byType = {};
  mealTypes.forEach(function (t) {
    byType[t] = checkMeal(students, menus.filter(function (m) { return m.mealType === t; }));
  });
  return byType;
}

/**
 * 담당자 일일 요약.
 * @param opts { force: 설정/급식 없음과 무관하게 발송, test: 종류를 '테스트'로 기록, date: 대상일(기본 오늘) }
 */
function runStaffDaily_(opts) {
  var o = opts || {};
  var settings = readSettings();
  if (!o.force && !settingBool_(settings, '담당자일일알림')) return { sent: 0, summary: '담당자 일일 알림이 꺼져 있습니다' };
  var date = o.date || todayStr_();
  var byType = checkDate_(date, settings);
  var msg = formatStaffDaily({ date: date, schoolName: settings['학교명'], byType: byType, webAppUrl: webAppUrl_(settings) });
  // 급식이 없는 날(주말·공휴일)은 설정이 켜져 있지 않으면 발송 생략
  if (!msg.hasMeals && !o.force && !settingBool_(settings, '주말공휴일알림')) {
    return { sent: 0, summary: date + ' 급식 데이터가 없어 발송하지 않음' };
  }
  // 테스트 발송은 중복키에 현재 시각을 섞어 매번 실제로 발송되게 한다
  var kind = o.test ? NOTICE_KINDS.TEST : NOTICE_KINDS.STAFF_DAILY;
  var r = sendToStaff_(settings, kind, date, msg, o.test ? String(Date.now()) : '');
  return { sent: r.sent, failed: r.failed, skipped: r.skipped, affectedCount: msg.affectedCount,
    summary: date + ' 담당자 알림: 발송 ' + r.sent + ', 실패 ' + r.failed + ', 중복 건너뜀 ' + r.skipped + ' (해당 학생 ' + msg.affectedCount + '명)' };
}

/** 담당자 주간 요약 (이번 주 월~일) */
function runStaffWeekly_(opts) {
  var o = opts || {};
  var settings = readSettings();
  if (!o.force && !settingBool_(settings, '담당자주간알림')) return { sent: 0, summary: '주간 알림이 꺼져 있습니다' };
  var today = o.date || todayStr_();
  var wr = weekRange(today);
  var mealTypes = managedMealTypes_(settings);
  var period = checkPeriod(readActiveStudents_(settings), readMealsInRange_(wr.start, wr.end, mealTypes), mealTypes);
  var msg = formatStaffWeekly({ weekStart: wr.start, weekEnd: wr.end, schoolName: settings['학교명'], period: period, webAppUrl: webAppUrl_(settings) });
  var r = sendToStaff_(settings, o.test ? NOTICE_KINDS.TEST : NOTICE_KINDS.STAFF_WEEKLY, wr.start, msg, o.test ? String(Date.now()) : '');
  return { sent: r.sent, failed: r.failed, skipped: r.skipped, summary: '주간 알림: 발송 ' + r.sent + ', 실패 ' + r.failed + ', 건너뜀 ' + r.skipped };
}

/**
 * 학부모 전날 알림. 다음 급식일(내일부터 7일 안)의 해당 학생에게 개별 발송.
 * 문자 채널 비활성 시 이메일로 대체(로그에 '대체발송').
 */
/**
 * 학부모 알림 계획(발송 없음). 설정 화면 미리보기와 실제 발송이 공유.
 * @returns { target, reason, items: [{ student, mealType, channel:'sms'|'email', to, subject, text, fallback, error, dedupeKey }] }
 */
function planParentNotices_(settings, today) {
  var mealTypes = managedMealTypes_(settings);
  var upcoming = readMealsInRange_(addDays(today, 1), addDays(today, 7), mealTypes);
  var target = nextMealDate(today, upcoming.map(function (m) { return m.date; }), 7);
  var plan = { target: target, reason: '', items: [] };
  if (!target) { plan.reason = '앞으로 7일 안에 급식 데이터가 없음'; return plan; }
  var students = readActiveStudents_(settings).filter(function (s) { return s.parentNotify !== PARENT_NOTIFY.NONE; });
  if (!students.length) { plan.reason = '학부모 알림 대상 학생(학부모알림≠없음)이 없음'; return plan; }
  var menus = upcoming.filter(function (m) { return m.date === target; });
  var smsOn = smsChannel_.isEnabled(settings);
  var emailOn = emailChannel_.isEnabled(settings);
  mealTypes.forEach(function (t) {
    var result = checkMeal(students, menus.filter(function (m) { return m.mealType === t; }));
    result.affected.forEach(function (a) {
      var st = a.student;
      var msg = formatParentMessage({ schoolName: settings['학교명'], date: target, mealType: t, student: st, items: a.items, todayStr: today });
      var item = { student: st, mealType: t, channel: st.parentNotify === PARENT_NOTIFY.SMS ? 'sms' : 'email', to: '', subject: msg.subject, text: msg.text, fallback: false, error: '' };
      item.to = item.channel === 'sms' ? st.parentPhone : st.parentEmail;
      // 문자를 원했지만 문자 채널이 꺼져 있으면 이메일로 대체 (이메일도 없으면 오류로 기록)
      if (item.channel === 'sms' && !smsOn) {
        if (st.parentEmail) { item.channel = 'email'; item.to = st.parentEmail; item.fallback = true; }
        else item.error = '문자 채널 비활성이고 이메일도 없음';
      }
      if (!item.error && item.channel === 'email' && !emailOn) item.error = '이메일 채널 비활성';
      if (!item.error && !item.to) item.error = '연락처 없음';
      item.dedupeKey = calcDedupeKey(NOTICE_KINDS.PARENT, target + '|' + t, item.to, studentKey(st));
      plan.items.push(item);
    });
  });
  return plan;
}

/**
 * 학부모 전날 알림 실행. 다음 급식일(내일부터 7일 안)의 해당 학생에게 개별 발송.
 * 문자 채널 비활성 시 이메일로 대체(로그에 '대체발송').
 */
function runParentNotices_(opts) {
  var o = opts || {};
  var started = Date.now();
  var settings = readSettings();
  if (!o.force && !settingBool_(settings, '학부모알림사용')) return { sent: 0, summary: '학부모 알림이 꺼져 있습니다' };
  var today = o.date || todayStr_();
  var plan = planParentNotices_(settings, today);
  if (!plan.target || !plan.items.length) return { sent: 0, target: plan.target, summary: plan.reason || (plan.target + ' 해당 학생 없음') };

  var done = readSuccessfulDedupeKeys_(addDays(today, -7));
  var out = { target: plan.target, sent: 0, failed: 0, skipped: 0, fallback: 0, truncated: false };
  for (var i = 0; i < plan.items.length; i++) {
    // 실행 시간 상한 초과 시 중단 — 이미 보낸 것은 중복키로 걸러지므로 다음 실행에서 나머지만 발송된다
    if (Date.now() - started > _PARENT_TIME_BUDGET_MS) { out.truncated = true; break; }
    var it = plan.items[i];
    var chName = it.channel === 'sms' ? CHANNELS.SMS : CHANNELS.EMAIL;
    if (it.error) {
      appendLog_({ channel: chName, kind: NOTICE_KINDS.PARENT, recipient: it.to, targetDate: plan.target, summary: it.text, ok: false, error: it.error + ' — ' + formatStudentLabel(it.student) });
      out.failed++;
      continue;
    }
    if (done[it.dedupeKey]) { out.skipped++; continue; }
    var r = it.channel === 'sms'
      ? smsChannel_.send({ to: it.to, text: it.text, settings: settings })
      : emailChannel_.send({ to: it.to, subject: it.subject, text: it.text });
    if (it.fallback) out.fallback++;
    appendLog_({ channel: chName, kind: NOTICE_KINDS.PARENT, recipient: it.to, targetDate: plan.target,
      summary: (it.fallback ? '대체발송(문자 비활성→이메일) ' : '') + it.text, ok: r.ok, error: r.error, dedupeKey: it.dedupeKey });
    r.ok ? out.sent++ : out.failed++;
  }
  out.summary = plan.target + ' 학부모 알림: 발송 ' + out.sent + ', 실패 ' + out.failed + ', 중복 건너뜀 ' + out.skipped +
    (out.fallback ? ', 이메일 대체 ' + out.fallback : '') + (out.truncated ? ' (시간 제한으로 중단 — 다음 실행에서 이어짐)' : '');
  return out;
}

/** 동기화 결과 담당자 알림 */
function sendSyncResultNotice_(result) {
  var settings = readSettings();
  var msg = formatSyncResult({ ok: result.ok, schoolName: settings['학교명'], months: result.months, stats: result.stats,
    uncheckedCount: result.uncheckedCount, error: result.error, webAppUrl: webAppUrl_(settings) });
  return sendToStaff_(settings, NOTICE_KINDS.SYNC_RESULT, todayStr_(), msg, (result.months || []).join(',') + '|' + (result.ok ? 'ok' : 'err'));
}

/** 채널 테스트 발송 (설정 화면 버튼). to 가 없으면 담당자 첫 번째 연락처. */
function sendTestNotice_(channelId, to) {
  var settings = readSettings();
  var ch = channelById_(channelId);
  if (!ch) return { ok: false, error: '알 수 없는 채널' };
  if (!ch.isEnabled(settings)) return { ok: false, error: '채널이 비활성 상태입니다: ' + (ch.disabledReason ? ch.disabledReason(settings) : '') };
  var target = to;
  if (!target) {
    if (channelId === 'email') target = settingList_(settings, '담당자이메일')[0];
    if (channelId === 'telegram') target = settingList_(settings, '담당자텔레그램chatid')[0];
  }
  if (!target) return { ok: false, error: '수신자를 입력하세요' };
  var text = '[' + (settings['학교명'] || '급식 알레르기') + '] 테스트 발송입니다. ' + nowStr_();
  var r = ch.send({ to: target, subject: '[급식 알레르기] 테스트 발송', text: text, html: '<p>' + text + '</p>', settings: settings });
  appendLog_({ channel: ch.name, kind: NOTICE_KINDS.TEST, recipient: target, targetDate: todayStr_(), summary: text, ok: r.ok, error: r.error });
  return r;
}
