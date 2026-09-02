/**
 * 학생 일괄 업로드 검증 + 병합 계획. 순수 함수.
 * 입력은 tableToObjects 로 만든 원시 객체 배열(문자열 셀), 출력은 행별 상태와 반영 계획.
 * 학생 식별키 = 학년도+학년+반+이름. 동명이인은 허용하되 경고한다.
 */

var _EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 휴대폰 번호 정규화: 010-1234-5678. 유효하지 않으면 null. 빈값은 ''. */
function normalizePhone(v) {
  var s = String(v === undefined || v === null ? '' : v).trim();
  if (s === '') return '';
  var digits = s.replace(/\D/g, '');
  if (digits === '') return null;
  if (digits.length === 11 && /^01[016789]/.test(digits)) {
    return digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7);
  }
  if (digits.length === 10 && /^01[016789]/.test(digits)) {
    return digits.slice(0, 3) + '-' + digits.slice(3, 6) + '-' + digits.slice(6);
  }
  return null;
}

/** 휴대폰·유선 모두 허용하는 전화 정규화 (담임 전화번호용). 빈값 '' / 유효하지 않으면 null */
function normalizeAnyPhone(v) {
  var s = String(v === undefined || v === null ? '' : v).trim();
  if (s === '') return '';
  var d = s.replace(/\D/g, '');
  if (d.length < 8 || d.length > 12) return null;
  if (d.length === 11) return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
  if (d.length === 10) return d.slice(0, 2) === '02' ? d.slice(0, 2) + '-' + d.slice(2, 6) + '-' + d.slice(6) : d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
  if (d.length === 9) return d.slice(0, 2) + '-' + d.slice(2, 5) + '-' + d.slice(5);
  return d;
}

/** 알레르기코드 셀 검증: 범위 밖 숫자가 있으면 오류. 반환 {codes, invalid:[]} */
function validateCodesCell(v) {
  var s = String(v === undefined || v === null ? '' : v).trim();
  var nums = (s.match(/\d+/g) || []).map(Number);
  var invalid = nums.filter(function (n) { return n < ALLERGEN_MIN || n > ALLERGEN_MAX; });
  var nonNumeric = s.replace(/[\d\s,.\-;、，()\/]/g, '');
  return { codes: parseAllergyCodes(s), invalid: invalid, hasGarbage: nonNumeric !== '' && s !== CODES_CHECKED_NONE };
}

function _isPosInt(v) {
  var n = Number(v);
  return String(v === undefined || v === null ? '' : v).trim() !== '' && Number.isInteger(n) && n > 0;
}

/**
 * 원시 행 하나 검증·정규화. 반환 { student, errors: string[] }
 * @param raw tableToObjects 결과 객체 (필드명은 FIELD_MAP.STUDENTS 값)
 * @param schoolYear 학년도가 비었을 때 채울 값
 */
function validateStudentRow(raw, schoolYear) {
  var errors = [];
  var grade = raw.grade, classNo = raw.classNo;
  if (!_isPosInt(grade)) errors.push('학년은 1 이상 숫자');
  if (!_isPosInt(classNo)) errors.push('반은 1 이상 숫자');
  var name = String(raw.name || '').trim();
  if (!name) errors.push('이름 없음');

  var sy = String(raw.schoolYear === undefined || raw.schoolYear === null ? '' : raw.schoolYear).trim();
  if (sy === '') sy = String(schoolYear);
  if (!/^\d{4}$/.test(sy)) errors.push('학년도는 4자리 숫자');

  var teacherPhone = normalizeAnyPhone(raw.teacherPhone);
  if (teacherPhone === null) errors.push('담임전화번호 형식 오류');

  var cv = validateCodesCell(raw.codes);
  if (cv.invalid.length) errors.push('알레르기코드 범위 밖: ' + cv.invalid.join(','));
  if (cv.hasGarbage) errors.push('알레르기코드에 숫자 외 문자');

  var email = String(raw.parentEmail || '').trim();
  if (email && !_EMAIL_RE.test(email)) errors.push('학부모이메일 형식 오류');

  var phone = normalizePhone(raw.parentPhone);
  if (phone === null) errors.push('학부모연락처 형식 오류(휴대폰 10~11자리)');

  var notify = String(raw.parentNotify || '').trim() || PARENT_NOTIFY.NONE;
  if (PARENT_NOTIFY_VALUES.indexOf(notify) < 0) errors.push('학부모알림은 없음/이메일/문자 중 하나');
  if (notify === PARENT_NOTIFY.EMAIL && !email) errors.push('학부모알림=이메일인데 이메일 없음');
  if (notify === PARENT_NOTIFY.SMS && !phone) errors.push('학부모알림=문자인데 연락처 없음');

  var student = {
    _row: raw._row,
    schoolYear: Number(sy),
    grade: Number(grade),
    classNo: Number(classNo),
    name: name,
    teacherName: String(raw.teacherName || '').trim(),
    teacherPhone: teacherPhone || '',
    codes: cv.codes,
    keywords: parseKeywords(raw.keywords),
    note: String(raw.note || '').trim(),
    parentEmail: email,
    parentPhone: phone || '',
    parentNotify: notify,
    active: raw.active === undefined || raw.active === '' ? true : toBool(raw.active, true),
  };
  return { student: student, errors: errors };
}

/** 두 학생의 갱신 대상 필드 비교 → 달라진 필드명 배열 */
var _MERGE_FIELDS = ['teacherName', 'teacherPhone', 'codes', 'keywords', 'note', 'parentEmail', 'parentPhone', 'parentNotify', 'active'];

function _diffFields(existing, incoming) {
  return _MERGE_FIELDS.filter(function (f) {
    var a = existing[f], b = incoming[f];
    if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a || []) !== JSON.stringify(b || []);
    return String(a === undefined ? '' : a) !== String(b === undefined ? '' : b);
  });
}

/**
 * 업로드 병합 계획.
 * - 키(학년도|학년|반|이름)가 같은 기존 학생이 있으면 "수정", 없으면 "추가". 삭제 없음.
 * - 동명이인: 같은 키가 여럿이면 파일 등장 순서 ↔ 시트 행 순서로 짝지어 수정하고, 남는 행은 추가. 모두 경고.
 * - 같은 반의 담임이름·전화번호가 서로 다르면 경고.
 * @returns {
 *   ok: boolean,               // 오류 0건이면 true (경고는 반영을 막지 않음)
 *   rows: [{ _row, status: '추가'|'수정'|'변경없음'|'오류', student, errors, warnings, changedFields, targetRow }],
 *   summary: { add, update, unchanged, error, warning }
 * }
 */
function calcStudentMergePlan(rawRows, existingStudents, schoolYear) {
  var existingByKey = {};   // key → 기존 학생 배열 (시트 행 순)
  existingStudents.slice().sort(function (a, b) { return (a._row || 0) - (b._row || 0); })
    .forEach(function (s) { (existingByKey[studentKey(s)] = existingByKey[studentKey(s)] || []).push(s); });

  var seenCount = {};       // key → 파일 안 등장 횟수
  var rows = rawRows.map(function (raw) {
    var v = validateStudentRow(raw, schoolYear);
    var st = v.student;
    var errors = v.errors.slice();
    var warnings = [];
    var status = '오류';
    var changedFields = [];
    var targetRow = null;

    if (!errors.length) {
      var key = studentKey(st);
      var nth = seenCount[key] || 0;
      seenCount[key] = nth + 1;
      var candidates = existingByKey[key] || [];
      var ex = candidates[nth] || null;
      if (!ex) {
        status = '추가';
      } else {
        targetRow = ex._row;
        changedFields = _diffFields(ex, st);
        status = changedFields.length ? '수정' : '변경없음';
      }
    }
    if (errors.length) status = '오류';
    return { _row: raw._row, status: status, student: st, errors: errors, warnings: warnings, changedFields: changedFields, targetRow: targetRow };
  });

  // 동명이인 경고 (파일 안 중복 + 기존 학생과의 중복 모두)
  rows.forEach(function (r) {
    if (r.status === '오류') return;
    var key = studentKey(r.student);
    var total = seenCount[key] + Math.max(0, (existingByKey[key] || []).length - seenCount[key]);
    if (total > 1) r.warnings.push('같은 반에 동명이인(' + r.student.name + ')이 ' + total + '명입니다. 시트에서 비고 등으로 구분하세요');
  });

  // 담임 불일치 경고: 반영 후 상태(파일 행 + 파일에 없는 기존 활성 학생) 기준
  var touched = {};
  rows.forEach(function (r) { if (r.targetRow) touched[r.targetRow] = true; });
  var after = rows.filter(function (r) { return r.status !== '오류'; }).map(function (r) { return r.student; })
    .concat(existingStudents.filter(function (s) { return !touched[s._row] && s.active !== false && Number(s.schoolYear) === Number(schoolYear); }));
  var tmap = buildTeacherMapFromStudents(after);
  rows.forEach(function (r) {
    if (r.status === '오류') return;
    var t = tmap[r.student.grade + '|' + r.student.classNo];
    if (t && t.conflict) r.warnings.push('같은 반(' + r.student.grade + '-' + r.student.classNo + ')의 담임 정보가 다릅니다: ' + formatTeacherCombos(t.combos));
  });

  var summary = { add: 0, update: 0, unchanged: 0, error: 0, warning: 0 };
  rows.forEach(function (r) {
    if (r.status === '추가') summary.add++;
    else if (r.status === '수정') summary.update++;
    else if (r.status === '변경없음') summary.unchanged++;
    else summary.error++;
    if (r.warnings.length) summary.warning++;
  });
  return { ok: summary.error === 0, rows: rows, summary: summary };
}

/** 정규화된 학생 → 시트 행 값 객체 (FIELD_MAP.STUDENTS 필드명 기준, 저장용 문자열 형태) */
function studentToSheetObject(s) {
  return {
    schoolYear: s.schoolYear,
    grade: s.grade,
    classNo: s.classNo,
    name: s.name,
    teacherName: s.teacherName || '',
    teacherPhone: s.teacherPhone || '',
    codes: formatAllergyCodes(s.codes),
    keywords: (s.keywords || []).join(','),
    note: s.note || '',
    parentEmail: s.parentEmail || '',
    parentPhone: s.parentPhone || '',
    parentNotify: s.parentNotify || PARENT_NOTIFY.NONE,
    active: s.active !== false,
  };
}
