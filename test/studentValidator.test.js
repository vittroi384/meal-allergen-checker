'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./helpers/loadCore');

const core = loadCore();

const raw = (over) => Object.assign({ _row: 2, grade: '3', classNo: '2', name: '홍길동', teacherName: '김담임', teacherPhone: '010-1111-2222', codes: '1,6' }, over);
const existing = (over) => core.normalizeStudent(Object.assign({ _row: 10, schoolYear: 2026, grade: 3, classNo: 2, name: '홍길동', teacherName: '김담임', teacherPhone: '010-1111-2222', codes: '1,6', active: true }, over));

test('normalizePhone', () => {
  assert.equal(core.normalizePhone('01012345678'), '010-1234-5678');
  assert.equal(core.normalizePhone('010-1234-5678'), '010-1234-5678');
  assert.equal(core.normalizePhone('0111234567'), '011-123-4567');
  assert.equal(core.normalizePhone(''), '');
  assert.equal(core.normalizePhone('02-555-1234'), null);
  assert.equal(core.normalizePhone('abc'), null);
});

test('normalizeAnyPhone accepts mobile and landline', () => {
  assert.equal(core.normalizeAnyPhone('01011112222'), '010-1111-2222');
  assert.equal(core.normalizeAnyPhone('0255512345'), '02-5551-2345');
  assert.equal(core.normalizeAnyPhone('031-123-4567'), '031-123-4567');
  assert.equal(core.normalizeAnyPhone(''), '');
  assert.equal(core.normalizeAnyPhone('123'), null);
});

test('validateStudentRow: valid row, fills school year, normalizes phones', () => {
  const r = core.validateStudentRow(raw({ parentEmail: 'a@b.com', parentNotify: '이메일', parentPhone: '01012345678', teacherPhone: '01011112222' }), 2026);
  assert.deepEqual(r.errors, []);
  assert.equal(r.student.schoolYear, 2026);
  assert.deepEqual(r.student.codes, [1, 6]);
  assert.equal(r.student.parentPhone, '010-1234-5678');
  assert.equal(r.student.teacherPhone, '010-1111-2222');
  assert.equal(r.student.active, true);
  assert.equal(r.student.number, undefined);
});

test('validateStudentRow: collects all errors', () => {
  const r = core.validateStudentRow(raw({ grade: '0', classNo: 'x', name: '', codes: '1,25', parentEmail: 'bad', parentNotify: '카톡', teacherPhone: '12' }), 2026);
  ['학년', '반', '이름', '범위 밖: 25', '이메일 형식', '학부모알림', '담임전화번호'].forEach((k) => assert.ok(r.errors.some((e) => e.includes(k)), k));
});

test('validateStudentRow: grade and class have no upper bound', () => {
  const r = core.validateStudentRow(raw({ grade: '7', classNo: '13' }), 2026);
  assert.deepEqual(r.errors, []);
  assert.equal(r.student.grade, 7);
  assert.equal(r.student.classNo, 13);
});

test('validateStudentRow: notify channel requires contact', () => {
  assert.ok(core.validateStudentRow(raw({ parentNotify: '문자' }), 2026).errors.some((e) => e.includes('연락처 없음')));
  assert.ok(core.validateStudentRow(raw({ parentNotify: '이메일' }), 2026).errors.some((e) => e.includes('이메일 없음')));
});

test('calcStudentMergePlan: add / update / unchanged keyed by grade+class+name', () => {
  const ex = [existing(), existing({ _row: 11, name: '김영희', codes: '2' })];
  const plan = core.calcStudentMergePlan(
    [
      raw({ _row: 2 }),                                          // 변경없음
      raw({ _row: 3, name: '김영희', codes: '2,6' }),             // 수정
      raw({ _row: 4, name: '신입생' }),                           // 추가
      raw({ _row: 5, grade: '0', name: '오류' }),                 // 오류
    ],
    ex, 2026,
  );
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.rows.map((r) => r.status), ['변경없음', '수정', '추가', '오류']);
  assert.deepEqual(plan.rows[1].changedFields, ['codes']);
  assert.equal(plan.rows[1].targetRow, 11);
  assert.deepEqual(plan.summary, { add: 1, update: 1, unchanged: 1, error: 1, warning: 0 });
});

test('calcStudentMergePlan: same-name students are paired in order and warned, not rejected', () => {
  const ex = [existing({ _row: 10, codes: '1' }), existing({ _row: 11, codes: '2' })];
  const plan = core.calcStudentMergePlan([raw({ _row: 2, codes: '1' }), raw({ _row: 3, codes: '2,6' }), raw({ _row: 4, codes: '3' })], ex, 2026);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.rows.map((r) => r.status), ['변경없음', '수정', '추가']);
  assert.equal(plan.rows[1].targetRow, 11);
  assert.ok(plan.rows.every((r) => r.warnings.some((w) => w.includes('동명이인'))));
  assert.equal(plan.summary.warning, 3);
});

test('calcStudentMergePlan: teacher mismatch in a class produces warnings', () => {
  const ex = [existing({ _row: 10, name: '기존', teacherName: '박담임', teacherPhone: '010-9999-8888' })];
  const plan = core.calcStudentMergePlan([raw(), raw({ _row: 3, name: '둘째' }), raw({ _row: 4, classNo: 5, name: '다른반', teacherName: '이담임', teacherPhone: '' })], ex, 2026);
  assert.equal(plan.ok, true);
  assert.equal(plan.summary.warning, 2);
  assert.ok(plan.rows[0].warnings[0].includes('3-2'));
  assert.ok(plan.rows[0].warnings[0].includes('박담임 010-9999-8888'));
  assert.deepEqual(plan.rows[2].warnings, []);
});

test('calcStudentMergePlan: same student in another school year is treated as add', () => {
  const plan = core.calcStudentMergePlan([raw()], [existing({ schoolYear: 2025 })], 2026);
  assert.equal(plan.rows[0].status, '추가');
});

test('calcStudentMergePlan: re-upload of inactive student reactivates', () => {
  const plan = core.calcStudentMergePlan([raw()], [existing({ active: false })], 2026);
  assert.equal(plan.rows[0].status, '수정');
  assert.deepEqual(plan.rows[0].changedFields, ['active']);
});

test('studentToSheetObject round-trips', () => {
  const s = core.validateStudentRow(raw({ keywords: '키위, 망고' }), 2026).student;
  const o = core.studentToSheetObject(s);
  assert.equal(o.codes, '1,6');
  assert.equal(o.keywords, '키위,망고');
  assert.equal(o.teacherName, '김담임');
  assert.equal(o.teacherPhone, '010-1111-2222');
  assert.equal(o.active, true);
  assert.equal(o.parentNotify, '없음');
  assert.equal('number' in o, false);
});
