/**
 * 학급(담임) 정보: 정규화, 학생에 담임 붙이기, 업로드 검증·병합 계획. 순수 함수.
 */

/** 휴대폰·유선 모두 허용하는 전화 정규화. 빈값 '' / 유효하지 않으면 null */
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

function normalizeClass(c) {
  return {
    _row: c._row,
    schoolYear: c.schoolYear === '' || c.schoolYear === undefined || c.schoolYear === null ? null : Number(c.schoolYear),
    grade: Number(c.grade),
    classNo: Number(c.classNo),
    teacherName: String(c.teacherName || '').trim(),
    teacherPhone: String(c.teacherPhone || '').trim(),
    teacherEmail: String(c.teacherEmail || '').trim(),
  };
}

function classKey(schoolYear, grade, classNo) {
  return [schoolYear, grade, classNo].join('|');
}

/** 학급 목록 → { 'grade|classNo': {name, phone, email, grade, classNo} } (해당 학년도 또는 학년도 미기재) */
function buildTeacherMap(classes, schoolYear) {
  var map = {};
  classes.forEach(function (c) {
    if (c.schoolYear !== null && c.schoolYear !== undefined && !isNaN(c.schoolYear) && Number(c.schoolYear) !== Number(schoolYear)) return;
    if (!c.teacherName && !c.teacherPhone && !c.teacherEmail) return;
    map[c.grade + '|' + c.classNo] = { name: c.teacherName, phone: c.teacherPhone, email: c.teacherEmail, grade: c.grade, classNo: c.classNo };
  });
  return map;
}

/** 학생 배열에 teacher 필드 부여 (없으면 null). 원본 불변 */
function attachTeachers(students, teacherMap) {
  return students.map(function (s) {
    return Object.assign({}, s, { teacher: teacherMap[s.grade + '|' + s.classNo] || null });
  });
}

/** '담임 김OO 010-1234-5678' / '담임 김OO' / '담임 미등록' */
function formatTeacherShort(teacher) {
  if (!teacher || !teacher.name) return '담임 미등록';
  return '담임 ' + teacher.name + (teacher.phone ? ' ' + teacher.phone : '');
}

var _CLASS_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function _isPosIntCell(v) {
  var n = Number(v);
  return String(v === undefined || v === null ? '' : v).trim() !== '' && Number.isInteger(n) && n > 0;
}

/** 학급 행 검증·정규화. 반환 { cls, errors } */
function validateClassRow(raw, schoolYear) {
  var errors = [];
  if (!_isPosIntCell(raw.grade) || Number(raw.grade) > 6) errors.push('학년은 1~6 숫자');
  if (!_isPosIntCell(raw.classNo)) errors.push('반은 1 이상 숫자');
  var sy = String(raw.schoolYear === undefined || raw.schoolYear === null ? '' : raw.schoolYear).trim();
  if (sy === '') sy = String(schoolYear);
  if (!/^\d{4}$/.test(sy)) errors.push('학년도는 4자리 숫자');
  var name = String(raw.teacherName || '').trim();
  if (!name) errors.push('담임이름 없음');
  var phone = normalizeAnyPhone(raw.teacherPhone);
  if (phone === null) errors.push('담임연락처 형식 오류');
  var email = String(raw.teacherEmail || '').trim();
  if (email && !_CLASS_EMAIL_RE.test(email)) errors.push('담임이메일 형식 오류');
  return {
    cls: { _row: raw._row, schoolYear: Number(sy), grade: Number(raw.grade), classNo: Number(raw.classNo), teacherName: name, teacherPhone: phone || '', teacherEmail: email },
    errors: errors,
  };
}

var _CLASS_FIELDS = ['teacherName', 'teacherPhone', 'teacherEmail'];

/**
 * 학급 업로드/인라인 저장 병합 계획. 키 = 학년도|학년|반. 같은 키가 있으면 수정, 없으면 추가. 삭제 없음.
 * @returns { ok, rows: [{_row, status, cls, errors, changedFields, targetRow}], summary }
 */
function calcClassMergePlan(rawRows, existingClasses, schoolYear) {
  var byKey = {};
  existingClasses.forEach(function (c) { byKey[classKey(c.schoolYear, c.grade, c.classNo)] = c; });
  var seen = {};
  var rows = rawRows.map(function (raw) {
    var v = validateClassRow(raw, schoolYear);
    var errors = v.errors.slice();
    var status = '오류', changedFields = [], targetRow = null;
    if (!errors.length) {
      var key = classKey(v.cls.schoolYear, v.cls.grade, v.cls.classNo);
      if (seen[key]) errors.push('파일 안에 같은 학년-반이 중복 (' + seen[key] + '행)');
      else seen[key] = raw._row;
      if (!errors.length) {
        var ex = byKey[key];
        if (!ex) status = '추가';
        else {
          targetRow = ex._row;
          changedFields = _CLASS_FIELDS.filter(function (f) { return String(ex[f] || '') !== String(v.cls[f] || ''); });
          status = changedFields.length ? '수정' : '변경없음';
        }
      }
    }
    if (errors.length) status = '오류';
    return { _row: raw._row, status: status, cls: v.cls, errors: errors, changedFields: changedFields, targetRow: targetRow };
  });
  var summary = { add: 0, update: 0, unchanged: 0, error: 0 };
  rows.forEach(function (r) {
    if (r.status === '추가') summary.add++; else if (r.status === '수정') summary.update++; else if (r.status === '변경없음') summary.unchanged++; else summary.error++;
  });
  return { ok: summary.error === 0, rows: rows, summary: summary };
}

function classToSheetObject(c) {
  return { schoolYear: c.schoolYear, grade: c.grade, classNo: c.classNo, teacherName: c.teacherName || '', teacherPhone: c.teacherPhone || '', teacherEmail: c.teacherEmail || '' };
}
