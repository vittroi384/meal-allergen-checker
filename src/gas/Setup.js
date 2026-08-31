/**
 * 시트 커스텀 메뉴 + setup(). 여러 번 실행해도 안전(멱등).
 */

var MENU_TITLE = '급식 알레르기';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(MENU_TITLE)
    .addItem('초기 설정 (처음 한 번 / 설정 변경 후)', 'setup')
    .addItem('웹앱 열기', 'menuOpenWebApp')
    .addItem('서식 다시 적용', 'menuReapplyFormatting')
    .addSeparator()
    .addItem('NEIS 인증키 입력/변경', 'menuSetNeisKey')
    .addItem('학교 검색·선택', 'menuSelectSchool')
    .addSeparator()
    .addItem('지금 급식 동기화 (이번 달 + 다음 달)', 'menuSyncNow')
    .addItem('오늘 담당자 알림 테스트 발송', 'menuTestDailyNotice')
    .addItem('템플릿 → 학생 반영', 'menuApplyTemplate')
    .addSeparator()
    .addItem('접속 비밀번호 재설정', 'menuResetPassword')
    .addItem('이관용 설정 내보내기', 'menuExportMigration')
    .addItem('이관용 설정 가져오기', 'menuImportMigration')
    .addItem('이 계정의 트리거 모두 해제', 'menuRemoveAllTriggers')
    .addToUi();
}

/** 시트를 직접 편집하면 읽기 캐시를 즉시 무효화 (단순 트리거) */
function onEdit(e) {
  try {
    var name = e && e.range ? e.range.getSheet().getName() : '';
    if ([SHEETS.STUDENTS, SHEETS.MEALS, SHEETS.SETTINGS].indexOf(name) >= 0) bumpDataVersion_();
  } catch (err) { /* 무시 */ }
}

/**
 * 초기 설정: 시트 구조 → 유효성 → 설정 기본값 → 트리거 → 비밀번호.
 * 시트 메뉴에서 실행하면 결과를 알림창으로 보여준다.
 */
function setup() {
  var report = [];
  ensureAllSheets_();
  bumpDataVersion_();
  report.push('시트 구조 확인/생성 완료 (학생, 급식, 알림로그, 설정, 학생_업로드템플릿)');

  var settings = readSettings();
  var created = setupTriggers_(settings);
  report.push('시간 트리거 ' + created + '개 등록 (기존 트리거 정리 후). 실제 실행 시각은 지정 시각 ±15분입니다.');

  var newPassword = null;
  if (!isPasswordSet_()) {
    newPassword = generatePassword_(10);
    setPassword_(newPassword);
  }

  try {
    var url = ScriptApp.getService().getUrl();
    if (url) { setState('WEBAPP_URL', url); writeSettings({ '웹앱URL': url }); }
  } catch (e) { /* 배포 전에는 URL 없음 */ }

  var msg = report.join('\n');
  if (newPassword) {
    msg += '\n\n★ 웹앱 접속 비밀번호 (이 창에서만 1회 표시됩니다. 지금 기록하세요):\n\n    ' + newPassword +
      '\n\n잊어버리면 메뉴 → "접속 비밀번호 재설정"으로 새로 만들 수 있습니다.';
  } else {
    msg += '\n\n접속 비밀번호는 기존 값이 유지됩니다.';
  }
  msg += '\n\n다음 단계: 확장 프로그램 → Apps Script → 배포 → 새 배포(웹앱)로 URL 을 만든 뒤, 웹앱 설정 화면에서 NEIS 인증키와 학교를 등록하세요.';
  _alert('초기 설정 완료', msg);
  return msg;
}

function _alert(title, msg) {
  try {
    SpreadsheetApp.getUi().alert(title, msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    console.log(title + '\n' + msg); // 에디터/트리거 컨텍스트에서는 UI 없음
  }
}

function _confirm(title, msg) {
  try {
    var ui = SpreadsheetApp.getUi();
    return ui.alert(title, msg, ui.ButtonSet.YES_NO) === ui.Button.YES;
  } catch (e) {
    return true;
  }
}

// ---------- 시트 구조 ----------

function ensureAllSheets_() {
  var ss = getSpreadsheet_();

  // 학생
  var st = ensureSheet_(SHEETS.STUDENTS, HEADERS.STUDENTS);
  _applyStudentValidations(st);

  // 급식
  var ml = ensureSheet_(SHEETS.MEALS, HEADERS.MEALS);
  _applyMealValidations(ml);

  // 알림로그
  var lg = ensureSheet_(SHEETS.LOGS, HEADERS.LOGS);

  // 설정
  var sg = ensureSheet_(SHEETS.SETTINGS, HEADERS.SETTINGS);
  _seedSettings(sg);

  // 템플릿
  var tp = ensureSheet_(SHEETS.TEMPLATE, HEADERS.STUDENTS);
  _applyStudentValidations(tp);
  _applyTemplateNotes(tp);

  // 기본 Sheet1 제거 (비어 있을 때만)
  ['Sheet1', '시트1'].forEach(function (n) {
    var s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });

  // 서식 (열 너비·헤더·필터·줄무늬·텍스트 서식)
  applyAllFormatting_();

  // 시트 순서
  var order = [SHEETS.STUDENTS, SHEETS.MEALS, SHEETS.SETTINGS, SHEETS.LOGS, SHEETS.TEMPLATE];
  order.forEach(function (name, i) {
    var s = ss.getSheetByName(name);
    if (s) { ss.setActiveSheet(s); ss.moveActiveSheet(i + 1); }
  });
  ss.setActiveSheet(ss.getSheetByName(SHEETS.STUDENTS));
}

function _col(sheet, header) {
  return headerIndex_(sheet)[header];
}

function _bodyRange(sheet, header) {
  var col = _col(sheet, header);
  if (!col) return null;
  return sheet.getRange(2, col, Math.max(1, sheet.getMaxRows() - 1), 1);
}

function _applyStudentValidations(sheet) {
  var dv = SpreadsheetApp.newDataValidation;
  var r;
  if ((r = _bodyRange(sheet, '학년'))) r.setDataValidation(dv().requireNumberBetween(1, 6).setAllowInvalid(false).setHelpText('1~6 숫자').build());
  if ((r = _bodyRange(sheet, '반'))) r.setDataValidation(dv().requireNumberGreaterThanOrEqualTo(1).setAllowInvalid(false).build());
  if ((r = _bodyRange(sheet, '번호'))) r.setDataValidation(dv().requireNumberGreaterThanOrEqualTo(1).setAllowInvalid(false).build());
  if ((r = _bodyRange(sheet, '학년도'))) r.setDataValidation(dv().requireNumberBetween(2000, 2100).setAllowInvalid(true).setHelpText('예: 2026 (비우면 현재 학년도)').build());
  if ((r = _bodyRange(sheet, '알레르기코드'))) {
    r.setNumberFormat('@');
    var a1 = r.getCell(1, 1).getA1Notation();
    r.setDataValidation(dv().requireFormulaSatisfied('=OR(' + a1 + '="", REGEXMATCH(TO_TEXT(' + a1 + '), "^[0-9,. ]+$"))')
      .setAllowInvalid(true).setHelpText('1~19 번호를 쉼표로 구분 (예: 1,2,6)').build());
  }
  if ((r = _bodyRange(sheet, '학부모연락처'))) r.setNumberFormat('@');
  if ((r = _bodyRange(sheet, '학부모알림'))) r.setDataValidation(dv().requireValueInList(PARENT_NOTIFY_VALUES, true).setAllowInvalid(false).build());
  if ((r = _bodyRange(sheet, '사용여부'))) r.setDataValidation(dv().requireCheckbox().build());
}

function _applyMealValidations(sheet) {
  var dv = SpreadsheetApp.newDataValidation;
  var r;
  if ((r = _bodyRange(sheet, '날짜'))) {
    r.setNumberFormat('@');
    var a1 = r.getCell(1, 1).getA1Notation();
    r.setDataValidation(dv().requireFormulaSatisfied('=OR(' + a1 + '="", REGEXMATCH(TO_TEXT(' + a1 + '), "^\\d{4}-\\d{2}-\\d{2}$"))')
      .setAllowInvalid(true).setHelpText('yyyy-MM-dd 형식 (예: 2026-09-01)').build());
  }
  if ((r = _bodyRange(sheet, '식사구분'))) r.setDataValidation(dv().requireValueInList(MEAL_TYPES, true).setAllowInvalid(false).build());
  if ((r = _bodyRange(sheet, '알레르기코드'))) r.setNumberFormat('@');
  if ((r = _bodyRange(sheet, '출처'))) r.setDataValidation(dv().requireValueInList([SOURCES.NEIS, SOURCES.MANUAL], true).setAllowInvalid(false).build());
  if ((r = _bodyRange(sheet, '수동수정여부'))) r.setDataValidation(dv().requireCheckbox().build());
}

function _seedSettings(sheet) {
  var values = sheet.getDataRange().getValues();
  var have = {};
  for (var i = 1; i < values.length; i++) {
    var k = String(values[i][0] || '').trim();
    if (k) have[k] = i + 1;
  }
  var toAdd = SETTING_DEFS.filter(function (d) { return !have[d[0]]; });
  if (toAdd.length) {
    var start = sheet.getLastRow() + 1;
    sheet.getRange(start, 1, toAdd.length, 3).setValues(toAdd.map(function (d) {
      var v = SETTING_BOOL_KEYS.indexOf(d[0]) >= 0 ? toBool(d[1], false) : d[1];
      return [d[0], v, d[2]];
    }));
  }
  // 불리언 키는 체크박스, 나머지는 텍스트 서식(시간 '07:30' 이 시각으로 변환되지 않도록)
  var all = sheet.getDataRange().getValues();
  for (var r = 1; r < all.length; r++) {
    var key = String(all[r][0] || '').trim();
    var cell = sheet.getRange(r + 1, 2);
    if (SETTING_BOOL_KEYS.indexOf(key) >= 0) {
      cell.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
      if (typeof all[r][1] !== 'boolean') cell.setValue(toBool(all[r][1], false));
    } else {
      cell.setNumberFormat('@');
    }
  }
}

function _applyTemplateNotes(sheet) {
  var idx = headerIndex_(sheet);
  var notes = {
    '학년도': '비우면 현재 학년도로 채워집니다',
    '알레르기코드': '1 난류, 2 우유, 3 메밀, 4 땅콩, 5 대두, 6 밀, 7 고등어, 8 게, 9 새우, 10 돼지고기, 11 복숭아, 12 토마토, 13 아황산류, 14 호두, 15 닭고기, 16 쇠고기, 17 오징어, 18 조개류, 19 잣\n쉼표로 구분: 1,2,6',
    '기타알레르기': '19종 외 키워드. 메뉴명에 포함되면 해당으로 판별. 예: 키위,망고',
    '학부모알림': '없음 / 이메일 / 문자 중 하나 (비우면 없음)',
    '학부모연락처': '휴대폰 번호 (010-1234-5678 또는 01012345678)',
    '사용여부': '비우면 사용(TRUE)',
  };
  Object.keys(notes).forEach(function (h) {
    if (idx[h]) sheet.getRange(1, idx[h]).setNote(notes[h]);
  });
  sheet.getRange(1, 1).setNote('엑셀에서 학생 명단을 복사해 2행부터 붙여넣은 뒤, 메뉴 [급식 알레르기] → "템플릿 → 학생 반영"을 실행하세요.\n' +
    '열 순서는 헤더명 기준으로 인식하므로 바꿔도 됩니다. 반영 후 이 시트의 내용은 지워집니다.');
  sheet.setTabColor('#f59e0b');
}

// ---------- 트리거 ----------

/** 우리 핸들러의 기존 트리거를 모두 지우고 설정에 맞춰 다시 등록. 등록 개수 반환. */
function setupTriggers_(settings) {
  removeOurTriggers_();
  var staff = parseTimeHHmm(settings['담당자알림시간']) || { hour: 7, minute: 30 };
  var parent = parseTimeHHmm(settings['학부모알림시간']) || { hour: 18, minute: 0 };
  var n = 0;
  ScriptApp.newTrigger('triggerDailySync').timeBased().everyDays(1).atHour(3).nearMinute(0).inTimezone('Asia/Seoul').create(); n++;
  ScriptApp.newTrigger('triggerMonthlySync').timeBased().onMonthDay(1).atHour(4).nearMinute(0).inTimezone('Asia/Seoul').create(); n++;
  ScriptApp.newTrigger('triggerStaffDaily').timeBased().everyDays(1).atHour(staff.hour).nearMinute(staff.minute).inTimezone('Asia/Seoul').create(); n++;
  ScriptApp.newTrigger('triggerStaffWeekly').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(staff.hour).nearMinute(staff.minute).inTimezone('Asia/Seoul').create(); n++;
  ScriptApp.newTrigger('triggerParentEvening').timeBased().everyDays(1).atHour(parent.hour).nearMinute(parent.minute).inTimezone('Asia/Seoul').create(); n++;
  return n;
}

function removeOurTriggers_() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (TRIGGER_HANDLERS.indexOf(t.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  return removed;
}

function listOurTriggers_() {
  return ScriptApp.getProjectTriggers()
    .filter(function (t) { return TRIGGER_HANDLERS.indexOf(t.getHandlerFunction()) >= 0; })
    .map(function (t) { return t.getHandlerFunction(); });
}

// ---------- 메뉴 항목 ----------

function menuOpenWebApp() {
  var url = getState('WEBAPP_URL') || readSettings()['웹앱URL'];
  if (!url) {
    _alert('웹앱 URL 없음', '아직 웹앱이 배포되지 않았습니다.\n확장 프로그램 → Apps Script → 배포 → 새 배포 → 유형 "웹 앱" 으로 배포한 뒤, 웹앱에 한 번 접속하면 URL 이 자동 기록됩니다.');
    return;
  }
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;padding:8px"><p>아래 링크를 클릭하세요.</p>' +
    '<p><a href="' + url + '" target="_blank" rel="noopener" style="font-size:15px">' + url + '</a></p>' +
    '<p style="color:#6b7280;font-size:12px">이 링크를 학교 담당자에게 공유하면 됩니다 (비밀번호 필요).</p></div>'
  ).setWidth(520).setHeight(160);
  SpreadsheetApp.getUi().showModalDialog(html, '웹앱 열기');
}

function menuResetPassword() {
  if (!_confirm('접속 비밀번호 재설정', '새 비밀번호를 만들고 기존 로그인 세션을 모두 종료합니다. 계속할까요?')) return;
  var pw = generatePassword_(10);
  setPassword_(pw);
  _alert('새 접속 비밀번호', '★ 새 비밀번호 (이 창에서만 1회 표시):\n\n    ' + pw + '\n\n웹앱 설정 화면에서 원하는 비밀번호로 바꿀 수 있습니다.');
}

function menuRemoveAllTriggers() {
  if (!_confirm('트리거 모두 해제', '이 계정에 등록된 자동 동기화/알림 트리거를 모두 해제합니다.\n' +
    '다른 계정으로 이관한 뒤 구 계정에서 실행하는 용도입니다. 계속할까요?')) return;
  var n = removeOurTriggers_();
  _alert('완료', n + '개의 트리거를 해제했습니다. 이 시트에서는 더 이상 자동 동기화/알림이 실행되지 않습니다.\n다시 켜려면 "초기 설정"을 실행하세요.');
}

/** NEIS 인증키 입력 (유효성 확인 후 Script Properties 에 저장) */
function menuSetNeisKey() {
  var ui = SpreadsheetApp.getUi();
  var status = hasSecret('NEIS_API_KEY') ? '현재: 설정됨 (새 키를 입력하면 교체됩니다)' : '현재: 미설정';
  var res = ui.prompt('NEIS 인증키 입력', status + '\n\nopen.neis.go.kr 에서 발급받은 인증키를 붙여넣으세요.\n(키는 시트가 아니라 스크립트 속성에 암호화 저장되며 어디에도 표시되지 않습니다)', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var key = String(res.getResponseText() || '').trim();
  if (!key) { _alert('취소됨', '입력된 키가 없습니다.'); return; }
  var test;
  try { test = testNeisKey_(key); } catch (e) { test = { ok: false, error: String(e.message || e) }; }
  if (!test.ok) {
    _alert('인증키 확인 실패', '저장하지 않았습니다.\n\n' + test.error + '\n\n키를 다시 확인하세요. (발급 직후에는 몇 분 걸릴 수 있습니다)');
    return;
  }
  setSecret('NEIS_API_KEY', key);
  _alert('저장 완료', 'NEIS 인증키가 유효하며 저장되었습니다.\n다음: 메뉴 → "학교 검색·선택"');
}

/** 학교 검색 → 번호 선택 → 설정 저장 */
function menuSelectSchool() {
  var ui = SpreadsheetApp.getUi();
  var settings = readSettings();
  var cur = settings['학교명'] ? '현재: ' + settings['학교명'] + ' (' + settings['시도교육청코드'] + '/' + settings['학교코드'] + ')\n\n' : '';
  var res = ui.prompt('학교 검색', cur + '학교명을 입력하세요 (예: 대치초, 서울대치초등학교)', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var r;
  try { r = searchSchools_(res.getResponseText()); } catch (e) { r = { ok: false, error: String(e.message || e), schools: [] }; }
  if (!r.ok) { _alert('검색 실패', r.error); return; }
  if (!r.schools.length) { _alert('검색 결과 없음', '다른 이름으로 다시 검색하세요.'); return; }
  var list = r.schools.slice(0, 15);
  var lines = list.map(function (s, i) { return (i + 1) + '. ' + s.name + ' — ' + s.kind + ', ' + s.atptName + '\n    ' + s.address; });
  var pick = ui.prompt('학교 선택 (' + r.schools.length + '건' + (r.schools.length > 15 ? ', 상위 15건 표시' : '') + ')',
    lines.join('\n') + '\n\n번호를 입력하세요:', ui.ButtonSet.OK_CANCEL);
  if (pick.getSelectedButton() !== ui.Button.OK) return;
  var n = parseInt(pick.getResponseText(), 10);
  if (!(n >= 1 && n <= list.length)) { _alert('취소됨', '올바른 번호가 아닙니다.'); return; }
  var s = list[n - 1];
  writeSettings({ '학교명': s.name, '시도교육청코드': s.atptCode, '학교코드': s.schoolCode });
  _alert('학교 저장 완료', s.name + ' (' + s.atptCode + ' / ' + s.schoolCode + ')\n\n다음: 메뉴 → "지금 급식 동기화"');
}

function menuSyncNow() {
  if (typeof runSyncMonths_ !== 'function') { _alert('준비 중', '동기화 기능은 아직 배포되지 않았습니다.'); return; }
  var ym = yearMonthOf(todayStr_());
  try {
    var r = runSyncMonths_([ym, addMonths(ym, 1)], { notify: false });
    _alert('동기화 결과', formatSyncResult(Object.assign({ schoolName: readSettings()['학교명'] }, r)).text);
  } catch (e) {
    _alert('동기화 실패', String(e.message || e));
  }
}

function menuTestDailyNotice() {
  if (typeof runStaffDaily_ !== 'function') { _alert('준비 중', '알림 기능은 아직 배포되지 않았습니다.'); return; }
  try {
    var r = runStaffDaily_({ force: true, test: true });
    _alert('테스트 발송 결과', r.summary || JSON.stringify(r));
  } catch (e) {
    _alert('발송 실패', String(e.message || e));
  }
}

/** 템플릿 시트 → 학생 병합 (검증 실패 시 전체 반려) */
function menuApplyTemplate() {
  var tp = getSheet_(SHEETS.TEMPLATE);
  if (tp.getLastRow() < 2) { _alert('템플릿 비어 있음', '학생_업로드템플릿 시트 2행부터 학생을 붙여넣은 뒤 실행하세요.'); return; }
  var values = tp.getRange(1, 1, tp.getLastRow(), tp.getLastColumn()).getValues();
  var plan = calcStudentMergePlan(tableToObjects(values, FIELD_MAP.STUDENTS), readStudents_(), currentSchoolYear_());
  if (!plan.ok) {
    var errs = plan.rows.filter(function (r) { return r.status === '오류'; }).slice(0, 15)
      .map(function (r) { return r._row + '행: ' + r.errors.join('; '); });
    _alert('반영 안 됨 — 오류 ' + plan.summary.error + '건',
      '오류를 고친 뒤 다시 실행하세요. (전체 반려)\n\n' + errs.join('\n') + (plan.summary.error > 15 ? '\n… 외 ' + (plan.summary.error - 15) + '건' : ''));
    return;
  }
  if (!_confirm('학생 반영', '추가 ' + plan.summary.add + '명, 수정 ' + plan.summary.update + '명, 변경 없음 ' + plan.summary.unchanged + '명.\n반영할까요? (삭제는 하지 않습니다)')) return;
  var res = applyStudentMergePlan_(plan);
  tp.getRange(2, 1, tp.getMaxRows() - 1, tp.getMaxColumns()).clearContent();
  _alert('반영 완료', '추가 ' + res.added + '명, 수정 ' + res.updated + '명. 템플릿 시트를 비웠습니다.');
}
