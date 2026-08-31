'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./helpers/loadCore');

const core = loadCore();
const st = (over) => core.normalizeStudent(Object.assign({ schoolYear: 2026, grade: 3, classNo: 2, name: 'A', teacherName: '김담임', teacherPhone: '010-1111-2222', codes: '6', active: true }, over));

test('buildTeacherMapFromStudents: majority combo, conflict on name or phone, empty ignored', () => {
  const map = core.buildTeacherMapFromStudents([st(), st({ name: 'B' }), st({ name: 'C', teacherPhone: '010-3333-4444' }), st({ name: 'D', teacherName: '', teacherPhone: '' }), st({ classNo: 3, name: 'E', teacherName: '', teacherPhone: '' })]);
  assert.deepEqual(Object.keys(map), ['3|2']);
  assert.equal(map['3|2'].name, '김담임');
  assert.equal(map['3|2'].phone, '010-1111-2222');
  assert.equal(map['3|2'].conflict, true);
  assert.equal(map['3|2'].combos.length, 2);
  const clean = core.buildTeacherMapFromStudents([st(), st({ name: 'B' })]);
  assert.equal(clean['3|2'].conflict, false);
});

test('attachTeachers / formatTeacherShort / calcTeacherConflicts / formatTeacherCombos', () => {
  const list = [st(), st({ name: 'B', teacherName: '박담임' }), st({ classNo: 9, name: 'C', teacherName: '', teacherPhone: '' })];
  const out = core.attachTeachers(list, core.buildTeacherMapFromStudents(list));
  assert.equal(out[0].teacher.name, '김담임');
  assert.equal(out[0].teacher.conflict, true);
  assert.equal(out[2].teacher, null);
  assert.equal(core.formatTeacherShort(out[0].teacher), '담임 김담임 010-1111-2222');
  assert.equal(core.formatTeacherShort({ name: '박', phone: '' }), '담임 박');
  assert.equal(core.formatTeacherShort(null), '담임 미등록');
  assert.equal(list[0].teacher, undefined);
  const conflicts = core.calcTeacherConflicts(list);
  assert.equal(conflicts.length, 1);
  assert.equal(core.formatTeacherCombos(conflicts[0].combos), '김담임 010-1111-2222, 박담임 010-1111-2222');
});

test('formatAffectedLine includes teacher when attached', () => {
  const menu = core.normalizeMenu({ date: '2026-09-01', mealType: '중식', name: '돈까스', codes: '6' });
  const s = [st({ name: '홍길동' })];
  const withT = core.checkMeal(core.attachTeachers(s, core.buildTeacherMapFromStudents(s)), [menu]);
  assert.equal(core.formatAffectedLine(withT.affected[0]), '3-2 홍길동 — 돈까스(밀) [담임 김담임 010-1111-2222]');
  const noT = core.checkMeal(core.attachTeachers(s, {}), [menu]);
  assert.ok(core.formatAffectedLine(noT.affected[0]).endsWith('[담임 미등록]'));
  const plain = core.checkMeal(s, [menu]);
  assert.equal(core.formatAffectedLine(plain.affected[0]), '3-2 홍길동 — 돈까스(밀)');
});
