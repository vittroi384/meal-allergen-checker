'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./helpers/loadCore');

const core = loadCore();
const cls = (over) => core.normalizeClass(Object.assign({ _row: 2, schoolYear: 2026, grade: 3, classNo: 2, teacherName: '김담임', teacherPhone: '010-1111-2222', teacherEmail: 't@school.kr' }, over));

test('normalizeAnyPhone accepts mobile and landline', () => {
  assert.equal(core.normalizeAnyPhone('01011112222'), '010-1111-2222');
  assert.equal(core.normalizeAnyPhone('0255512345'), '02-5551-2345');
  assert.equal(core.normalizeAnyPhone('031-123-4567'), '031-123-4567');
  assert.equal(core.normalizeAnyPhone(''), '');
  assert.equal(core.normalizeAnyPhone('123'), null);
});

test('buildTeacherMap filters by school year and skips empty rows', () => {
  const map = core.buildTeacherMap([cls(), cls({ _row: 3, classNo: 3, schoolYear: 2025, teacherName: '작년' }), cls({ _row: 4, classNo: 4, schoolYear: '', teacherName: '연도없음' }), cls({ _row: 5, classNo: 5, teacherName: '', teacherPhone: '', teacherEmail: '' })], 2026);
  assert.deepEqual(Object.keys(map).sort(), ['3|2', '3|4']);
  assert.equal(map['3|2'].name, '김담임');
});

test('attachTeachers and formatTeacherShort', () => {
  const students = [core.normalizeStudent({ schoolYear: 2026, grade: 3, classNo: 2, number: 1, name: 'A', codes: '1' }), core.normalizeStudent({ schoolYear: 2026, grade: 3, classNo: 9, number: 1, name: 'B', codes: '1' })];
  const out = core.attachTeachers(students, core.buildTeacherMap([cls()], 2026));
  assert.equal(out[0].teacher.name, '김담임');
  assert.equal(out[1].teacher, null);
  assert.equal(core.formatTeacherShort(out[0].teacher), '담임 김담임 010-1111-2222');
  assert.equal(core.formatTeacherShort(out[1].teacher), '담임 미등록');
  assert.equal(core.formatTeacherShort({ name: '박', phone: '' }), '담임 박');
  assert.equal(students[0].teacher, undefined); // 원본 불변
});

test('validateClassRow', () => {
  const ok = core.validateClassRow({ _row: 2, grade: '3', classNo: '2', teacherName: '김담임', teacherPhone: '01011112222', teacherEmail: '' }, 2026);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.cls.schoolYear, 2026);
  assert.equal(ok.cls.teacherPhone, '010-1111-2222');
  const bad = core.validateClassRow({ _row: 3, grade: '7', classNo: '', teacherName: '', teacherPhone: 'abc', teacherEmail: 'x' }, 2026);
  assert.equal(bad.errors.length, 5);
});

test('calcClassMergePlan: add / update / unchanged / dup', () => {
  const plan = core.calcClassMergePlan(
    [
      { _row: 2, grade: 3, classNo: 2, teacherName: '김담임', teacherPhone: '010-1111-2222', teacherEmail: 't@school.kr' },
      { _row: 3, grade: 3, classNo: 2, teacherName: '중복' },
      { _row: 4, grade: 3, classNo: 3, teacherName: '새담임' },
      { _row: 5, grade: 3, classNo: 4, teacherName: '바뀐담임' },
    ],
    [cls(), cls({ _row: 10, classNo: 4, teacherName: '옛담임' })],
    2026,
  );
  assert.deepEqual(plan.rows.map((r) => r.status), ['변경없음', '오류', '추가', '수정']);
  assert.deepEqual(plan.rows[3].changedFields, ['teacherName', 'teacherPhone', 'teacherEmail']);
  assert.equal(plan.rows[3].targetRow, 10);
  assert.equal(plan.ok, false);
});

test('formatAffectedLine includes teacher when attached', () => {
  const st = core.attachTeachers([core.normalizeStudent({ schoolYear: 2026, grade: 3, classNo: 2, number: 15, name: '홍길동', codes: '6' })], core.buildTeacherMap([cls()], 2026));
  const menu = core.normalizeMenu({ date: '2026-09-01', mealType: '중식', name: '돈까스', codes: '6' });
  const r = core.checkMeal(st, [menu]);
  assert.equal(core.formatAffectedLine(r.affected[0]), '3-2-15 홍길동 — 돈까스(밀) [담임 김담임 010-1111-2222]');
  const noTeacher = core.checkMeal(core.attachTeachers(st, {}), [menu]);
  assert.ok(core.formatAffectedLine(noTeacher.affected[0]).endsWith('[담임 미등록]'));
  const plain = core.checkMeal([core.normalizeStudent({ schoolYear: 2026, grade: 3, classNo: 2, number: 15, name: '홍길동', codes: '6' })], [menu]);
  assert.equal(core.formatAffectedLine(plain.affected[0]), '3-2-15 홍길동 — 돈까스(밀)');
});

test('formatTeacherDaily', () => {
  const st = core.attachTeachers([core.normalizeStudent({ schoolYear: 2026, grade: 3, classNo: 2, number: 15, name: '홍길동', codes: '6' })], core.buildTeacherMap([cls()], 2026));
  const r = core.checkMeal(st, [core.normalizeMenu({ date: '2026-09-01', mealType: '중식', name: '돈까스', codes: '6' })]);
  const m = core.formatTeacherDaily({ date: '2026-09-01', schoolName: '대치초', grade: 3, classNo: 2, teacher: st[0].teacher, byType: { '중식': r.affected } });
  assert.equal(m.subject, '[대치초] 9/1(화) 3학년 2반 급식 알레르기 주의 학생 1명');
  assert.ok(m.text.includes('김담임 선생님'));
  assert.ok(m.text.includes('15번 홍길동 — 돈까스(밀)'));
});
