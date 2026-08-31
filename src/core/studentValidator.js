/**
 * 학생 일괄 업로드 검증 + 병합 계획. 순수 함수.
 * 입력은 tableToObjects 로 만든 원시 객체 배열(문자열 셀), 출력은 행별 상태와 반영 계획.
 */

var _EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 전화번호 정규화: 숫자만 남기고 010-1234-5678 형태. 유효하지 않으면 null. 빈값은 ''. */
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
  return String(v).trim() !== '' && Number.isInteger(n) && n > 0;
}

/**
 * 원시 행 하나 검증·정규화. 반환 { student, errors: string[] }
 * @param raw tableToObjects 결과 객체 (필드명은 FIELD_MAP.STUDENTS 값)
 * @param schoolYear 학년도가 비었을 때 채울 값
 */
function validateStudentRow(raw, schoolYear) {
  var errors = [];
  var grade = raw.grade, classNo = raw.classNo, number = raw.number;
  if (!_isPosInt(grade) || Number(grade) > 6) errors.push('학년은 1~6 숫자');
  if (!_isPosInt(classNo)) errors.push('반은 1 이상 숫자');
  if (!_isPosInt(number)) errors.push('번호는 1 이상 숫자');
  var name = String(raw.name || '').trim();
  if (!name) errors.push('이름 없음');

  var sy = String(raw.schoolYear === undefined || raw.schoolYear === null ? '' : raw.schoolYear).trim();
  if (sy === '') sy = String(schoolYear);
  if (!/^\d{4}$/.test(sy)) errors.push('학년도는 4자리 숫자');

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
    number: Number(number),
    name: name,
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
var _MERGE_FIELDS = ['codes', 'keywords', 'note', 'parentEmail', 'parentPhone', 'parentNotify', 'active'];

function _diffFields(existing, incoming) {
  return _MERGE_FIELDS.filter(function (f) {
    var a = existing[f], b = incoming[f];
    if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a || []) !== JSON.stringify(b || []);
    return String(a === undefined ? '' : a) !== String(b === undefined ? '' : b);
  });
}

/**
 * 업로드 병합 계획.
 * @param rawRows tableToObjects 결과
 * @param existingStudents normalizeStudent 된 기존 학생 (전체 학년도)
 * @param schoolYear 현재 학년도
 * @returns {
 *   ok: boolean,               // 오류 0건이면 true
 *   rows: [{ _row, status: '추가'|'수정'|'변경없음'|'오류', student, errors, changedFields, targetRow }],
 *   summary: { add, update, unchanged, error }
 * }
 */
function calcStudentMergePlan(rawRows, existingStudents, schoolYear) {
  var byKey = {};      // 학년도|학년|반|번호 → 기존 학생
  existingStudents.forEach(function (s) { byKey[studentKey(s)] = s; });

  var seenInFile = {};
  var rows = rawRows.map(function (raw) {
    var v = validateStudentRow(raw, schoolYear);
    var st = v.student;
    var errors = v.errors.slice();
    var status = '오류';
    var changedFields = [];
    var targetRow = null;

    if (!errors.length) {
      var key = studentKey(st);
      var ex = byKey[key];
      if (seenInFile[key]) {
        errors.push('파일 안에 같은 학년-반-번호가 중복 (' + seenInFile[key] + '행)');
      } else {
        seenInFile[key] = raw._row;
      }
      if (ex && ex.name !== st.name) {
        errors.push(st.grade + '-' + st.classNo + '-' + st.number + ' 에 이미 다른 학생(' + ex.name +
          ')이 있습니다. 기존 학생을 비활성화하거나 번호를 확인하세요');
      }
      if (!errors.length) {
        if (!ex) {
          status = '추가';
        } else {
          targetRow = ex._row;
          changedFields = _diffFields(ex, st);
          status = changedFields.length ? '수정' : '변경없음';
        }
      }
    }
    if (errors.length) status = '오류';
    return { _row: raw._row, status: status, student: st, errors: errors, changedFields: changedFields, targetRow: targetRow };
  });

  var summary = { add: 0, update: 0, unchanged: 0, error: 0 };
  rows.forEach(function (r) {
    if (r.status === '추가') summary.add++;
    else if (r.status === '수정') summary.update++;
    else if (r.status === '변경없음') summary.unchanged++;
    else summary.error++;
  });
  return { ok: summary.error === 0, rows: rows, summary: summary };
}

/** 정규화된 학생 → 시트 행 값 객체 (FIELD_MAP.STUDENTS 필드명 기준, 저장용 문자열 형태) */
function studentToSheetObject(s) {
  return {
    schoolYear: s.schoolYear,
    grade: s.grade,
    classNo: s.classNo,
    number: s.number,
    name: s.name,
    codes: formatAllergyCodes(s.codes),
    keywords: (s.keywords || []).join(','),
    note: s.note || '',
    parentEmail: s.parentEmail || '',
    parentPhone: s.parentPhone || '',
    parentNotify: s.parentNotify || PARENT_NOTIFY.NONE,
    active: s.active !== false,
  };
}
