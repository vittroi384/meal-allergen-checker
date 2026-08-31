/**
 * Google Sheets 리포지토리. 읽기 → core 정규화, 쓰기는 배열로 모아 한 번에.
 */

function getSpreadsheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('바인딩된 스프레드시트를 찾을 수 없습니다');
  return ss;
}

function getSheet_(name) {
  var sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('시트가 없습니다: ' + name + ' — 시트 메뉴 [급식 알레르기] → 초기 설정을 실행하세요');
  return sheet;
}

/** 시트가 없으면 만들고 헤더를 기록. 있으면 헤더 누락분만 보정. */
function ensureSheet_(name, headers) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (headers && headers.length) {
    var lastCol = Math.max(sheet.getLastColumn(), headers.length);
    var current = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); });
    var missing = headers.filter(function (h) { return current.indexOf(h) < 0; });
    if (current.every(function (h) { return h === ''; })) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    } else if (missing.length) {
      var start = current.filter(function (h) { return h !== ''; }).length + 1;
      sheet.getRange(1, start, 1, missing.length).setValues([missing]);
    }
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight('bold').setBackground('#f3f4f6');
  }
  return sheet;
}

/** 헤더명 → 1-based 열 번호 맵 */
function headerIndex_(sheet) {
  var row = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  var idx = {};
  row.forEach(function (h, i) {
    var k = String(h || '').trim();
    if (k) idx[k] = i + 1;
  });
  return idx;
}

/** 시트 전체 → 객체 배열 (_row 포함) */
function readTable_(sheetName, fieldMap) {
  var sheet = getSheet_(sheetName);
  if (sheet.getLastRow() < 2) return [];
  var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  return tableToObjects(values, fieldMap);
}

/** 객체 배열을 시트 하단에 한 번에 추가 (헤더 순서에 맞춤) */
function appendObjects_(sheetName, headers, fieldMap, objects) {
  if (!objects || !objects.length) return 0;
  var sheet = getSheet_(sheetName);
  var idx = headerIndex_(sheet);
  var width = sheet.getLastColumn();
  var rows = objects.map(function (o) {
    var row = new Array(width).fill('');
    headers.forEach(function (h) {
      var col = idx[h];
      if (!col) return;
      var v = o[fieldMap[h]];
      row[col - 1] = v === undefined || v === null ? '' : v;
    });
    return row;
  });
  var start = sheet.getLastRow() + 1;
  sheet.getRange(start, 1, rows.length, width).setValues(rows);
  if (sheetName !== SHEETS.LOGS) bumpDataVersion_();
  return rows.length;
}

/** 특정 행의 값을 객체로 갱신 (헤더에 있는 필드만) */
function updateObjectRow_(sheetName, rowNumber, headers, fieldMap, obj) {
  var sheet = getSheet_(sheetName);
  var idx = headerIndex_(sheet);
  var width = sheet.getLastColumn();
  var range = sheet.getRange(rowNumber, 1, 1, width);
  var row = range.getValues()[0];
  headers.forEach(function (h) {
    var col = idx[h];
    var f = fieldMap[h];
    if (!col || !(f in obj)) return;
    var v = obj[f];
    row[col - 1] = v === undefined || v === null ? '' : v;
  });
  range.setValues([row]);
  if (sheetName !== SHEETS.LOGS) bumpDataVersion_();
}

/** 행 삭제. rowNumbers 는 내림차순으로 정렬해 처리. 연속 구간은 한 번에 삭제. */
function deleteRows_(sheetName, rowNumbers) {
  if (!rowNumbers || !rowNumbers.length) return 0;
  var sheet = getSheet_(sheetName);
  var sorted = rowNumbers.slice().sort(function (a, b) { return b - a; });
  var i = 0;
  var deleted = 0;
  while (i < sorted.length) {
    var end = sorted[i];
    var start = end;
    while (i + 1 < sorted.length && sorted[i + 1] === start - 1) { i++; start--; }
    sheet.deleteRows(start, end - start + 1);
    deleted += end - start + 1;
    i++;
  }
  if (sheetName !== SHEETS.LOGS) bumpDataVersion_();
  return deleted;
}

// ---------- 도메인별 읽기/쓰기 ----------

/** 전체 학생 (정규화). 10분 캐시, 학생 시트 변경 시 즉시 무효화. */
function readStudents_() {
  return cached_('students', function () {
    return readTable_(SHEETS.STUDENTS, FIELD_MAP.STUDENTS).map(normalizeStudent);
  });
}

/** 현재 학년도 반별 담임 맵 (학생 시트 "담임" 열에서 유추) */
function teacherMap_(settings) {
  var s = settings || readSettings();
  return buildTeacherMapFromStudents(filterActiveStudents(readStudents_(), currentSchoolYear_(s)));
}

/** 판별 대상 학생 (활성 + 현재 학년도) — 반별 담임(teacher) 을 붙여서 반환 */
function readActiveStudents_(settings) {
  var s = settings || readSettings();
  var active = filterActiveStudents(readStudents_(), currentSchoolYear_(s));
  return attachTeachers(active, buildTeacherMapFromStudents(active));
}

/** 전체 급식 행 (정규화, 날짜는 yyyy-MM-dd 문자열). 10분 캐시, 급식 시트 변경 시 즉시 무효화. */
function readMeals_() {
  return cached_('meals', function () {
    return readTable_(SHEETS.MEALS, FIELD_MAP.MEALS).map(function (m) {
      m.date = cellToDateStr(m.date);
      return normalizeMenu(m);
    });
  });
}

/** 기간·끼니로 필터한 급식 행 */
function readMealsInRange_(start, end, mealTypes) {
  return readMeals_().filter(function (m) {
    return m.date >= start && m.date <= end && (!mealTypes || mealTypes.indexOf(m.mealType) >= 0);
  });
}

function appendMeals_(rows) {
  return appendObjects_(SHEETS.MEALS, HEADERS.MEALS, FIELD_MAP.MEALS, rows);
}

function deleteMealRows_(rowNumbers) {
  return deleteRows_(SHEETS.MEALS, rowNumbers);
}

function appendStudents_(students) {
  return appendObjects_(SHEETS.STUDENTS, HEADERS.STUDENTS, FIELD_MAP.STUDENTS, students.map(studentToSheetObject));
}

function updateStudentRow_(rowNumber, student) {
  updateObjectRow_(SHEETS.STUDENTS, rowNumber, HEADERS.STUDENTS, FIELD_MAP.STUDENTS, studentToSheetObject(student));
}

/**
 * 알림로그 기록.
 * @param e { channel, kind, recipient, targetDate, summary, ok, error, dedupeKey }
 */
function appendLog_(e) {
  try {
    appendObjects_(SHEETS.LOGS, HEADERS.LOGS, FIELD_MAP.LOGS, [{
      sentAt: nowStr_(),
      channel: e.channel || CHANNELS.SYSTEM,
      kind: e.kind || NOTICE_KINDS.SYSTEM,
      recipient: maskRecipient(e.recipient || ''),
      targetDate: e.targetDate || '',
      summary: summarizeForLog(e.summary || ''),
      ok: e.ok === true,
      error: e.error ? String(e.error).slice(0, 500) : '',
      dedupeKey: e.dedupeKey || '',
    }]);
  } catch (err) {
    console.error('알림로그 기록 실패: ' + err);
  }
}

/** 시스템 오류 로그 (트리거·API 실패) */
function logError_(where, err) {
  console.error(where + ': ' + (err && err.stack ? err.stack : err));
  appendLog_({ channel: CHANNELS.SYSTEM, kind: NOTICE_KINDS.SYSTEM, summary: where, ok: false, error: String(err && err.message ? err.message : err) });
}

/** 최근 로그 n건 (최신순) */
function readLogs_(limit) {
  var rows = readTable_(SHEETS.LOGS, FIELD_MAP.LOGS);
  rows.reverse();
  return rows.slice(0, limit || 200);
}

/** 성공한 발송의 중복키 집합 (최근 rows 기준) */
function readSuccessfulDedupeKeys_(sinceDate) {
  var set = {};
  readTable_(SHEETS.LOGS, FIELD_MAP.LOGS).forEach(function (r) {
    if (r.ok === true && r.dedupeKey && (!sinceDate || String(r.sentAt).slice(0, 10) >= sinceDate)) set[r.dedupeKey] = true;
  });
  return set;
}
