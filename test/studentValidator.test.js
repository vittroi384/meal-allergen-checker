'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./helpers/loadCore');

const core = loadCore();

const raw = (over) => Object.assign({ _row: 2, grade: '3', classNo: '2', number: '15', name: '홍길동', codes: '1,6' }, over);
const existing = (over) => core.normalizeStudent(Object.assign({ _row: 10, schoolYear: 2026, grade: 3, classNo: 2, number: 15, name: '홍길동', codes: '1,6', active: true }, over));

test('normalizePhone', () => {
  assert.equal(core.normalizePhone('01012345678'), '010-1234-5678');
  assert.equal(core.normalizePhone('010-1234-5678'), '010-1234-5678');
  assert.equal(core.normalizePhone('0111234567'), '011-123-4567');
  assert.equal(core.normalizePhone(''), '');
  assert.equal(core.normalizePhone('02-555-1234'), null);
  assert.equal(core.normalizePhone('abc'), null);
});

test('validateStudentRow: valid row, fills school year', () => {
  const r = core.validateStudentRow(raw({ parentEmail: 'a@b.com', parentNotify: '이메일', parentPhone: '01012345678' }), 2026);
  assert.deepEqual(r.errors, []);
  assert.equal(r.student.schoolYear, 2026);
  assert.deepEqual(r.student.codes, [1, 6]);
  assert.equal(r.student.parentPhone, '010-1234-5678');
  assert.equal(r.student.active, true);
});

test('validateStudentRow: collects all errors', () => {
  const r = core.validateStudentRow(raw({ grade: '7', number: 'x', name: '', codes: '1,25', parentEmail: 'bad', parentNotify: '카톡' }), 2026);
  assert.ok(r.errors.some((e) => e.includes('학년')));
  assert.ok(r.errors.some((e) => e.includes('번호')));
  assert.ok(r.errors.some((e) => e.includes('이름')));
  assert.ok(r.errors.some((e) => e.includes('범위 밖: 25')));
  assert.ok(r.errors.some((e) => e.includes('이메일 형식')));
  assert.ok(r.errors.some((e) => e.includes('학부모알림')));
});

test('validateStudentRow: notify channel requires contact', () => {
  assert.ok(core.validateStudentRow(raw({ parentNotify: '문자' }), 2026).errors.some((e) => e.includes('연락처 없음')));
  assert.ok(core.validateStudentRow(raw({ parentNotify: '이메일' }), 2026).errors.some((e) => e.includes('이메일 없음')));
});

test('calcStudentMergePlan: add / update / unchanged / name conflict / in-file duplicate', () => {
  const ex = [existing(), existing({ _row: 11, number: 16, name: '김영희', codes: '2' })];
  const plan = core.calcStudentMergePlan(
    [
      raw({ _row: 2 }),                                             // 변경없음
      raw({ _row: 3, number: 16, name: '김영희', codes: '2,6' }),    // 수정
      raw({ _row: 4, number: 17, name: '신입생' }),                  // 추가
      raw({ _row: 5, number: 15, name: '다른사람' }),                // 오류: 이름 불일치
      raw({ _row: 6, number: 17, name: '신입생' }),                  // 오류: 파일 내 중복
    ],
    ex,
    2026,
  );
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.rows.map((r) => r.status), ['변경없음', '수정', '추가', '오류', '오류']);
  assert.deepEqual(plan.rows[1].changedFields, ['codes']);
  assert.equal(plan.rows[1].targetRow, 11);
  assert.ok(plan.rows[3].errors.some((e) => e.includes('다른 학생(홍길동)')));
  assert.ok(plan.rows[3].errors.some((e) => e.includes('중복 (2행)')));
  assert.ok(plan.rows[4].errors.some((e) => e.includes('중복 (4행)')));
  assert.deepEqual(plan.summary, { add: 1, update: 1, unchanged: 1, error: 2 });
});

test('calcStudentMergePlan: same student in another school year is treated as add', () => {
  const plan = core.calcStudentMergePlan([raw()], [existing({ schoolYear: 2025 })], 2026);
  assert.equal(plan.rows[0].status, '추가');
  assert.equal(plan.ok, true);
});

test('calcStudentMergePlan: re-upload of inactive student reactivates (active counts as change)', () => {
  const plan = core.calcStudentMergePlan([raw()], [existing({ active: false })], 2026);
  assert.equal(plan.rows[0].status, '수정');
  assert.deepEqual(plan.rows[0].changedFields, ['active']);
});

test('studentToSheetObject round-trips', () => {
  const s = core.validateStudentRow(raw({ keywords: '키위, 망고' }), 2026).student;
  const o = core.studentToSheetObject(s);
  assert.equal(o.codes, '1,6');
  assert.equal(o.keywords, '키위,망고');
  assert.equal(o.active, true);
  assert.equal(o.parentNotify, '없음');
});
