/**
 * 날짜 유틸. 시간대 문제를 피하기 위해 모든 입력·출력은 'yyyy-MM-dd' 문자열.
 * 내부 계산은 UTC 기준 Date 를 쓰므로 실행 환경의 시간대에 영향받지 않는다.
 */

/** 'yyyy-MM-dd' 형식이면서 실제 존재하는 날짜인지 (예: '2026-02-30' 은 false) */
function isValidDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var p = s.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}

// 'yyyy-MM-dd' → UTC 자정 Date 객체 (내부 계산 전용)
function _dateStrToUtc(s) {
  var p = s.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2]));
}

// UTC Date 객체 → 'yyyy-MM-dd' (내부 계산 전용)
function _utcToDateStr(d) {
  var y = d.getUTCFullYear();
  var m = String(d.getUTCMonth() + 1).padStart(2, '0');
  var day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/** 'yyyy-MM-dd' → 'yyyyMMdd' (NEIS 파라미터용) */
function toYmd(dateStr) {
  return dateStr.replace(/-/g, '');
}

/** 'yyyyMMdd' → 'yyyy-MM-dd' */
function fromYmd(ymd) {
  var s = String(ymd);
  return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
}

/** dateStr 에 n일 더한 'yyyy-MM-dd' (n 이 음수면 빼기, 월·년 경계 자동 처리) */
function addDays(dateStr, n) {
  var d = _dateStrToUtc(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return _utcToDateStr(d);
}

/** 0=일 … 6=토 */
function dayOfWeek(dateStr) {
  return _dateStrToUtc(dateStr).getUTCDay();
}

/** 토요일·일요일 여부 */
function isWeekend(dateStr) {
  var dow = dayOfWeek(dateStr);
  return dow === 0 || dow === 6;
}

/** 해당 날짜가 속한 주의 월요일~일요일 */
function weekRange(dateStr) {
  var dow = dayOfWeek(dateStr);
  var offsetToMonday = dow === 0 ? -6 : 1 - dow;
  var start = addDays(dateStr, offsetToMonday);
  return { start: start, end: addDays(start, 6) };
}

/** 'yyyy-MM' → 그 달의 첫날/마지막날 */
function monthRange(yearMonth) {
  var p = yearMonth.split('-').map(Number);
  var start = new Date(Date.UTC(p[0], p[1] - 1, 1));
  var end = new Date(Date.UTC(p[0], p[1], 0));
  return { start: _utcToDateStr(start), end: _utcToDateStr(end) };
}

/** 'yyyy-MM' 에 n개월 더하기 */
function addMonths(yearMonth, n) {
  var p = yearMonth.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1 + n, 1));
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

/** 'yyyy-MM-dd' → 'yyyy-MM' */
function yearMonthOf(dateStr) {
  return dateStr.slice(0, 7);
}

/** 두 날짜 사이의 모든 날짜 (양 끝 포함) */
function eachDay(startStr, endStr) {
  var out = [];
  var cur = startStr;
  while (cur <= endStr) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/** 학년도: 3월 1일 ~ 다음 해 2월 말. override 가 유효한 4자리면 그 값 사용. */
function calcSchoolYear(dateStr, override) {
  if (override !== undefined && override !== null && String(override).trim() !== '') {
    var o = parseInt(String(override).trim(), 10);
    if (!isNaN(o) && o >= 2000 && o <= 2100) return o;
  }
  var p = dateStr.split('-').map(Number);
  return p[1] >= 3 ? p[0] : p[0] - 1;
}

/** '2026-09-01' → '9/1(화)' */
function formatKoreanDate(dateStr, withYear) {
  var p = dateStr.split('-').map(Number);
  var s = p[1] + '/' + p[2] + '(' + KOREAN_DAYS[dayOfWeek(dateStr)] + ')';
  return withYear ? p[0] + '년 ' + s : s;
}

/** '2026-09-01' → '2026년 9월 1일 (화)' */
function formatKoreanDateLong(dateStr) {
  var p = dateStr.split('-').map(Number);
  return p[0] + '년 ' + p[1] + '월 ' + p[2] + '일 (' + KOREAN_DAYS[dayOfWeek(dateStr)] + ')';
}

/** 'HH:mm' → { hour, minute } 또는 null */
function parseTimeHHmm(s) {
  var m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(s || ''));
  if (!m) return null;
  var h = Number(m[1]);
  var min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { hour: h, minute: min };
}

/**
 * 다음 급식일 후보: 내일부터 최대 maxLookahead 일 중 mealDates(set/array) 에 있는 첫 날짜.
 * 학부모 "전날 알림" 에서 금요일 저녁엔 월요일 급식을 알리기 위해 사용.
 */
function nextMealDate(todayStr, mealDates, maxLookahead) {
  var set = Array.isArray(mealDates) ? new Set(mealDates) : mealDates;
  var limit = maxLookahead || 7;
  for (var i = 1; i <= limit; i++) {
    var d = addDays(todayStr, i);
    if (set.has(d)) return d;
  }
  return null;
}
