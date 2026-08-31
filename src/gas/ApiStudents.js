/**
 * 학생 관리 API: 목록, 추가/수정, 활성/비활성, 일괄 업로드(xlsx/붙여넣기) 미리보기·반영.
 */

function apiStudents(token) {
  requireSession(token);
  var settings = readSettings();
  var schoolYear = currentSchoolYear_(settings);
  return { schoolYear: schoolYear, students: attachTeachers(sortStudents(readStudents_()), teacherMap_(settings)).map(serializeStudent_) };
}

/**
 * 학생 1명 저장. raw = { _row?, schoolYear?, grade, classNo, number, name, codes(배열 또는 문자열), keywords, note, parentEmail, parentPhone, parentNotify, active }
 * @returns { ok, errors?, student? }
 */
function apiSaveStudent(token, raw) {
  requireSession(token);
  var input = Object.assign({}, raw);
  if (Array.isArray(input.codes)) input.codes = input.codes.join(',');
  if (Array.isArray(input.keywords)) input.keywords = input.keywords.join(',');
  var v = validateStudentRow(input, currentSchoolYear_());
  if (v.errors.length) return { ok: false, errors: v.errors };
  var st = v.student;
  var key = studentKey(st);
  var existing = readStudents_();
  var conflict = existing.filter(function (s) { return studentKey(s) === key && s._row !== raw._row; })[0];
  if (conflict) return { ok: false, errors: [st.grade + '-' + st.classNo + '-' + st.number + ' 은(는) 이미 ' + conflict.name + ' 학생이 사용 중입니다'] };
  if (raw._row) {
    var target = existing.filter(function (s) { return s._row === raw._row; })[0];
    if (!target) return { ok: false, errors: ['수정할 학생을 찾지 못했습니다. 새로고침 후 다시 시도하세요'] };
    updateStudentRow_(raw._row, st);
    st._row = raw._row;
  } else {
    appendStudents_([st]);
  }
  return { ok: true, student: serializeStudent_(st) };
}

function apiSetStudentActive(token, row, active) {
  requireSession(token);
  var s = readStudents_().filter(function (x) { return x._row === row; })[0];
  if (!s) throw new Error('학생을 찾지 못했습니다');
  s.active = !!active;
  updateStudentRow_(row, s);
  return { ok: true };
}

// ---------- 일괄 업로드 ----------

/** 업로드 입력 → 원시 행 (헤더 없으면 학생 시트 열 순서로 간주). 값은 모두 JSON 직렬화 가능한 문자열/숫자/불리언. */
function studentRowsFromInput_(input) {
  var values;
  if (input.base64) values = xlsxBase64ToValues_(input.base64, input.filename);
  else values = parseTsv(input.tsv);
  values = values.filter(function (r) { return r.some(function (c) { return String(c === null || c === undefined ? '' : c).trim() !== ''; }); });
  if (!values.length) throw new Error('읽을 데이터가 없습니다');
  if (!detectHeaderRow(values[0], ['학년', '반', '번호', '이름'])) {
    values = [HEADERS.STUDENTS.slice()].concat(values);
  }
  return sanitizeRows_(tableToObjects(values, FIELD_MAP.STUDENTS));
}

function sanitizeRows_(rows) {
  return rows.map(function (r) {
    var o = {};
    Object.keys(r).forEach(function (k) {
      var v = r[k];
      if (v instanceof Date) v = cellToDateStr(v);
      else if (v !== null && typeof v === 'object') v = String(v);
      o[k] = v;
    });
    return o;
  });
}

function serializeMergePlan_(plan) {
  return {
    ok: plan.ok,
    summary: plan.summary,
    rows: plan.rows.map(function (r) {
      return { _row: r._row, status: r.status, errors: r.errors, changedFields: r.changedFields, targetRow: r.targetRow, student: serializeStudent_(r.student) };
    }),
  };
}

/** @param input { tsv?, base64?, filename? }  @returns { rawRows, plan } */
function apiPreviewStudentUpload(token, input) {
  requireSession(token);
  var rawRows = studentRowsFromInput_(input || {});
  if (rawRows.length > 2000) throw new Error('한 번에 2,000명까지 업로드할 수 있습니다');
  var plan = calcStudentMergePlan(rawRows, readStudents_(), currentSchoolYear_());
  return { rawRows: rawRows, plan: serializeMergePlan_(plan) };
}

/** 미리보기에서 받은 rawRows 를 그대로 되돌려 받아 서버에서 다시 계산 후 반영 */
function apiApplyStudentUpload(token, rawRows) {
  requireSession(token);
  var lock = LockService.getScriptLock();
  lock.waitLock(20 * 1000);
  try {
    var plan = calcStudentMergePlan(rawRows || [], readStudents_(), currentSchoolYear_());
    if (!plan.ok) return { ok: false, error: '오류 행이 ' + plan.summary.error + '건 있어 반영하지 않았습니다. 미리보기를 다시 확인하세요', plan: serializeMergePlan_(plan) };
    var r = applyStudentMergePlan_(plan);
    return { ok: true, added: r.added, updated: r.updated, unchanged: r.unchanged };
  } finally {
    lock.releaseLock();
  }
}
