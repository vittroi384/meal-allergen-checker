/**
 * 학급(담임) API: 목록, 인라인 저장(추가/수정), 일괄 업로드 미리보기·반영.
 */

function apiClasses(token) {
  requireSession(token);
  var schoolYear = currentSchoolYear_();
  var list = readClasses_().slice().sort(function (a, b) {
    return ((b.schoolYear || 0) - (a.schoolYear || 0)) || (a.grade - b.grade) || (a.classNo - b.classNo);
  });
  // 학생 시트에 있는 반 중 담임 미등록 반 (안내용)
  var registered = {};
  list.forEach(function (c) { if (!c.schoolYear || c.schoolYear === schoolYear) registered[c.grade + '|' + c.classNo] = true; });
  var missing = {};
  filterActiveStudents(readStudents_(), schoolYear).forEach(function (s) { if (!registered[s.grade + '|' + s.classNo]) missing[s.grade + '|' + s.classNo] = { grade: s.grade, classNo: s.classNo }; });
  return {
    schoolYear: schoolYear,
    classes: list.map(serializeClass_),
    missing: Object.keys(missing).sort().map(function (k) { return missing[k]; }),
  };
}

/** 한 반 저장 (인라인 수정/추가). raw = { _row?, schoolYear?, grade, classNo, teacherName, teacherPhone, teacherEmail } */
function apiSaveClass(token, raw) {
  requireSession(token);
  var plan = calcClassMergePlan([Object.assign({ _row: raw._row || 0 }, raw)], readClasses_(), currentSchoolYear_());
  var r = plan.rows[0];
  if (r.status === '오류') return { ok: false, errors: r.errors };
  if (r.status === '수정') updateClassRow_(r.targetRow, r.cls);
  else if (r.status === '추가') appendClasses_([r.cls]);
  return { ok: true, status: r.status };
}

function classRowsFromInput_(input) {
  var values;
  if (input.base64) values = xlsxBase64ToValues_(input.base64, input.filename);
  else values = parseTsv(input.tsv);
  values = values.filter(function (r) { return r.some(function (c) { return String(c === null || c === undefined ? '' : c).trim() !== ''; }); });
  if (!values.length) throw new Error('읽을 데이터가 없습니다');
  if (!detectHeaderRow(values[0], ['학년', '반'])) values = [HEADERS.CLASSES.slice()].concat(values);
  return sanitizeRows_(tableToObjects(values, FIELD_MAP.CLASSES));
}

function serializeClassPlan_(plan) {
  return { ok: plan.ok, summary: plan.summary, rows: plan.rows.map(function (r) { return { _row: r._row, status: r.status, errors: r.errors, changedFields: r.changedFields, cls: serializeClass_(r.cls) }; }) };
}

function apiPreviewClassUpload(token, input) {
  requireSession(token);
  var rawRows = classRowsFromInput_(input || {});
  return { rawRows: rawRows, plan: serializeClassPlan_(calcClassMergePlan(rawRows, readClasses_(), currentSchoolYear_())) };
}

function apiApplyClassUpload(token, rawRows) {
  requireSession(token);
  var lock = LockService.getScriptLock();
  lock.waitLock(20 * 1000);
  try {
    var plan = calcClassMergePlan(rawRows || [], readClasses_(), currentSchoolYear_());
    if (!plan.ok) return { ok: false, error: '오류 행 ' + plan.summary.error + '건 — 반영하지 않았습니다', plan: serializeClassPlan_(plan) };
    var updated = 0;
    plan.rows.filter(function (r) { return r.status === '수정'; }).forEach(function (r) { updateClassRow_(r.targetRow, r.cls); updated++; });
    var added = appendClasses_(plan.rows.filter(function (r) { return r.status === '추가'; }).map(function (r) { return r.cls; }));
    return { ok: true, added: added, updated: updated, unchanged: plan.summary.unchanged };
  } finally {
    lock.releaseLock();
  }
}
