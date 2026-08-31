/**
 * 알림 문구 생성 (담당자 일일/주간, 학부모, 동기화 결과) + 중복키. 순수 함수.
 * 입력은 checkMeal / checkPeriod 결과.
 */

function _esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 메뉴 한 줄: '돈까스 [밀(6), 돼지고기(10)]' / '김치 [확인 필요]' / '쌀밥' */
function formatMenuLine(menu) {
  if (menu.needsCheck) return menu.name + ' [확인 필요]';
  if (!menu.codes.length) return menu.name;
  return menu.name + ' [' + formatAllergenTags(menu.codes) + ']';
}

/** 해당 학생 한 줄: '3-2-15 홍길동 — 돈까스(밀, 돼지고기), 계란찜(난류) [담임 김OO 010-…]' (담임 정보가 붙어 있을 때만) */
function formatAffectedLine(a) {
  var line = formatStudentLabel(a.student) + ' — ' + a.items.map(formatAffectedItem).join(', ');
  if (a.student.teacher !== undefined) line += ' [' + formatTeacherShort(a.student.teacher) + ']';
  return line;
}


/**
 * 담당자 일일 요약.
 * @param p { date, schoolName, byType: {중식: checkMeal결과,...}, webAppUrl }
 * @returns { subject, text, html, hasMeals, affectedCount }
 */
function formatStaffDaily(p) {
  var types = Object.keys(p.byType || {});
  var hasMeals = types.some(function (t) { return p.byType[t].menus.length > 0; });
  var affectedCount = 0;
  var textParts = [];
  var htmlParts = [];
  var title = '[' + (p.schoolName || '급식 알레르기') + '] ' + formatKoreanDate(p.date, true) + ' 급식 알레르기 안내';

  textParts.push(title);
  htmlParts.push('<h2 style="margin:0 0 12px;font-size:18px">' + _esc(title) + '</h2>');

  if (!hasMeals) {
    textParts.push('오늘은 등록된 급식 데이터가 없습니다.');
    htmlParts.push('<p>오늘은 등록된 급식 데이터가 없습니다.</p>');
  }

  types.forEach(function (t) {
    var r = p.byType[t];
    if (!r.menus.length) return;
    affectedCount += r.affected.length;
    textParts.push('');
    textParts.push('■ ' + t + ' 메뉴');
    r.menus.forEach(function (m) { textParts.push('  - ' + formatMenuLine(m)); });
    textParts.push('');
    textParts.push('■ ' + t + ' 해당 학생 (' + r.affected.length + '명)');
    if (!r.affected.length) textParts.push('  해당 학생 없음');
    r.affected.forEach(function (a) { textParts.push('  - ' + formatAffectedLine(a)); });
    if (r.uncheckedMenus.length) {
      textParts.push('');
      textParts.push('■ 알레르기 표시가 없는 메뉴 (확인 필요): ' + r.uncheckedMenus.join(', '));
    }

    htmlParts.push('<h3 style="margin:16px 0 6px;font-size:15px">' + _esc(t) + ' 메뉴</h3><ul style="margin:0;padding-left:18px">');
    r.menus.forEach(function (m) {
      var badge = m.needsCheck ? ' <span style="color:#b45309;font-weight:600">[확인 필요]</span>' : '';
      var tags = m.codes.length ? ' <span style="color:#6b7280">[' + _esc(formatAllergenTags(m.codes)) + ']</span>' : '';
      htmlParts.push('<li>' + _esc(m.name) + tags + badge + '</li>');
    });
    htmlParts.push('</ul>');
    htmlParts.push('<h3 style="margin:16px 0 6px;font-size:15px">' + _esc(t) + ' 해당 학생 <span style="color:#dc2626">' + r.affected.length + '명</span></h3>');
    if (!r.affected.length) {
      htmlParts.push('<p style="margin:0;color:#6b7280">해당 학생 없음</p>');
    } else {
      var withTeacher = r.affected.some(function (a) { return a.student.teacher !== undefined; });
      htmlParts.push('<table cellpadding="6" style="border-collapse:collapse;font-size:14px">' +
        '<tr style="background:#f3f4f6"><th align="left">학생</th><th align="left">문제 메뉴(원인)</th>' + (withTeacher ? '<th align="left">담임</th>' : '') + '</tr>');
      r.affected.forEach(function (a) {
        htmlParts.push('<tr style="border-top:1px solid #e5e7eb"><td><b>' + _esc(formatStudentLabel(a.student)) + '</b></td><td>' +
          _esc(a.items.map(formatAffectedItem).join(', ')) + '</td>' +
          (withTeacher ? '<td style="color:#374151">' + _esc(formatTeacherShort(a.student.teacher).replace(/^담임 /, '')) + '</td>' : '') + '</tr>');
      });
      htmlParts.push('</table>');
    }
    if (r.uncheckedMenus.length) {
      htmlParts.push('<p style="margin:12px 0 0;color:#b45309"><b>알레르기 표시가 없는 메뉴 (확인 필요):</b> ' + _esc(r.uncheckedMenus.join(', ')) + '</p>');
    }
  });

  if (p.webAppUrl) {
    textParts.push('');
    textParts.push('자세히 보기: ' + p.webAppUrl);
    htmlParts.push('<p style="margin-top:20px"><a href="' + _esc(p.webAppUrl) + '">웹앱에서 자세히 보기</a></p>');
  }

  var subject = title + (hasMeals ? ' — 해당 ' + affectedCount + '명' : '');
  return { subject: subject, text: textParts.join('\n'), html: '<div style="font-family:sans-serif;line-height:1.5">' + htmlParts.join('') + '</div>',
    hasMeals: hasMeals, affectedCount: affectedCount };
}

/**
 * 담당자 주간 요약.
 * @param p { weekStart, weekEnd, schoolName, period: checkPeriod결과, webAppUrl }
 */
function formatStaffWeekly(p) {
  var title = '[' + (p.schoolName || '급식 알레르기') + '] 주간 급식 알레르기 요약 (' +
    formatKoreanDate(p.weekStart) + ' ~ ' + formatKoreanDate(p.weekEnd) + ')';
  var text = [title, ''];
  var html = ['<h2 style="margin:0 0 12px;font-size:18px">' + _esc(title) + '</h2>'];
  var dates = Object.keys(p.period || {}).sort();
  if (!dates.length) {
    text.push('이번 주 등록된 급식 데이터가 없습니다.');
    html.push('<p>이번 주 등록된 급식 데이터가 없습니다.</p>');
  }
  dates.forEach(function (date) {
    var byType = p.period[date];
    Object.keys(byType).forEach(function (t) {
      var r = byType[t];
      var head = formatKoreanDate(date) + ' ' + t + ' — 해당 ' + r.affected.length + '명' +
        (r.uncheckedMenus.length ? ', 확인 필요 ' + r.uncheckedMenus.length + '개' : '');
      text.push('■ ' + head);
      r.affected.forEach(function (a) { text.push('  - ' + formatAffectedLine(a)); });
      text.push('');
      html.push('<h3 style="margin:14px 0 4px;font-size:15px">' + _esc(head) + '</h3>');
      if (r.affected.length) {
        html.push('<ul style="margin:0;padding-left:18px">');
        r.affected.forEach(function (a) { html.push('<li>' + _esc(formatAffectedLine(a)) + '</li>'); });
        html.push('</ul>');
      }
    });
  });
  if (p.webAppUrl) {
    text.push('자세히 보기: ' + p.webAppUrl);
    html.push('<p style="margin-top:20px"><a href="' + _esc(p.webAppUrl) + '">웹앱에서 자세히 보기</a></p>');
  }
  return { subject: title, text: text.join('\n'), html: '<div style="font-family:sans-serif;line-height:1.5">' + html.join('') + '</div>' };
}

/**
 * 학부모 문구 (짧게).
 * @param p { schoolName, date, mealType, student, items, todayStr }
 * '[OO초] 내일(9/1) 중식에 홍길동 학생이 못 먹는 메뉴가 있습니다: 돈까스(밀, 돼지고기)'
 */
function formatParentMessage(p) {
  var rel = p.todayStr && addDays(p.todayStr, 1) === p.date ? '내일' : '';
  var dateLabel = (rel ? rel + '(' : '') + formatKoreanDate(p.date).replace(/\(.\)$/, '') + (rel ? ')' : formatKoreanDate(p.date).slice(-3));
  var school = p.schoolName ? '[' + p.schoolName + '] ' : '';
  var text = school + dateLabel + ' ' + p.mealType + '에 ' + p.student.name + ' 학생이 못 먹는 메뉴가 있습니다: ' +
    p.items.map(formatAffectedItem).join(', ');
  var subject = school + dateLabel + ' ' + p.mealType + ' 알레르기 주의 안내 (' + p.student.name + ')';
  return { subject: subject, text: text };
}

/** 동기화 결과 문구 */
function formatSyncResult(p) {
  var s = p.stats || {};
  var title = '[' + (p.schoolName || '급식 알레르기') + '] 급식 동기화 ' + (p.ok ? '완료' : '실패') + ' (' + (p.months || []).join(', ') + ')';
  var lines = [title];
  if (p.ok) {
    lines.push('가져온 끼니 ' + (s.mealsFetched || 0) + '개 / 신규 ' + (s.mealsInserted || 0) + ' / 변경 ' + (s.mealsReplaced || 0) +
      ' / 동일 ' + (s.mealsUnchanged || 0) + ' / 삭제 ' + (s.mealsRemoved || 0) + ' / 수동 보호 ' + (s.mealsProtected || 0));
    if (p.uncheckedCount) lines.push('알레르기 표시 없는 메뉴: ' + p.uncheckedCount + '개 (웹앱에서 확인 필요)');
  } else {
    lines.push('오류: ' + (p.error || '알 수 없음'));
  }
  if (p.webAppUrl) lines.push('웹앱: ' + p.webAppUrl);
  return { subject: title, text: lines.join('\n') };
}

/** 중복 발송 방지 키. 학생 단위 알림은 studentKey 포함. */
function calcDedupeKey(kind, targetDate, recipient, studentKeyStr) {
  return [kind, targetDate, recipient, studentKeyStr || ''].join('|');
}

/** 로그용 수신자 마스킹: 이메일 ab***@x.com, 전화 010-****-5678 */
function maskRecipient(r) {
  var s = String(r || '');
  var at = s.indexOf('@');
  if (at > 0) return s.slice(0, Math.min(2, at)) + '***' + s.slice(at);
  var digits = s.replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(0, 3) + '-****-' + digits.slice(-4);
  return s;
}

/** SMS 바이트 수 (EUC-KR 기준: 한글 2바이트). 90 바이트 초과면 LMS. */
function calcSmsBytes(text) {
  var bytes = 0;
  for (var i = 0; i < text.length; i++) bytes += text.charCodeAt(i) > 127 ? 2 : 1;
  return bytes;
}

/** 로그 요약 100자 */
function summarizeForLog(text) {
  var s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > 100 ? s.slice(0, 97) + '...' : s;
}
