'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./helpers/loadCore');

const core = loadCore();

const student = (over) =>
  core.normalizeStudent(Object.assign({ schoolYear: 2026, grade: 3, classNo: 2, name: '홍길동', codes: '', keywords: '', active: true }, over));
const menu = (over) =>
  core.normalizeMenu(Object.assign({ date: '2026-09-01', mealType: '중식', name: '쌀밥', codes: '' }, over));

test('parseAllergyCodes accepts many separators, dedupes, sorts, drops out-of-range', () => {
  assert.deepEqual(core.parseAllergyCodes('1, 6 , 5'), [1, 5, 6]);
  assert.deepEqual(core.parseAllergyCodes('1.5.6.'), [1, 5, 6]);
  assert.deepEqual(core.parseAllergyCodes('(1.5.6)'), [1, 5, 6]);
  assert.deepEqual(core.parseAllergyCodes('6,6,20,0'), [6]);
  assert.deepEqual(core.parseAllergyCodes(''), []);
  assert.deepEqual(core.parseAllergyCodes('-'), []);
  assert.deepEqual(core.parseAllergyCodes([6, 1]), [1, 6]);
  assert.deepEqual(core.parseAllergyCodes(null), []);
});

test('formatAllergyCodes / allergenNames / formatAllergenTags', () => {
  assert.equal(core.formatAllergyCodes([1, 6]), '1,6');
  assert.deepEqual(core.allergenNames([1, 6, 18]), ['난류', '밀', '조개류']);
  assert.equal(core.formatAllergenTags([6, 10]), '밀(6), 돼지고기(10)');
});

test('normalizeMenu: needsCheck only when no codes and not checked-none', () => {
  assert.equal(menu({ codes: '' }).needsCheck, true);
  assert.equal(menu({ codes: '-' }).needsCheck, false);
  assert.equal(menu({ codes: '-' }).checkedNone, true);
  assert.equal(menu({ codes: '1' }).needsCheck, false);
});

test('checkMeal matches by code intersection', () => {
  const students = [student({ codes: '6,10' }), student({ name: '김영희', codes: '2' })];
  const menus = [menu({ name: '돈까스', codes: '1,5,6,10' }), menu({ name: '쌀밥', codes: '-' })];
  const r = core.checkMeal(students, menus);
  assert.equal(r.affected.length, 1);
  assert.equal(r.affected[0].student.name, '홍길동');
  assert.deepEqual(r.affected[0].items[0].matchedCodes, [6, 10]);
  assert.equal(core.formatAffectedItem(r.affected[0].items[0]), '돈까스(밀, 돼지고기)');
  assert.deepEqual(r.uncheckedMenus, []);
});

test('checkMeal matches keywords in menu name ignoring spaces/case', () => {
  const students = [student({ keywords: '키위, 망고' })];
  const menus = [menu({ name: '키 위 요거트', codes: '2' }), menu({ name: '망고빙수', codes: '' })];
  const r = core.checkMeal(students, menus);
  assert.equal(r.affected.length, 1);
  assert.equal(r.affected[0].items.length, 2);
  assert.deepEqual(r.affected[0].items[0].matchedKeywords, ['키위']);
  assert.deepEqual(r.uncheckedMenus, ['망고빙수']);
  assert.equal(core.formatAffectedItem(r.affected[0].items[0]), '키 위 요거트(키위)');
});

test('checkMeal combines code and keyword reasons and sorts students', () => {
  const students = [
    student({ grade: 3, classNo: 2, name: 'B', codes: '6', keywords: '키위' }),
    student({ grade: 1, classNo: 1, name: 'A', codes: '6' }),
  ];
  const r = core.checkMeal(students, [menu({ name: '키위 파이', codes: '6' })]);
  assert.deepEqual(r.affected.map((a) => a.student.name), ['A', 'B']);
  assert.equal(core.formatAffectedItem(r.affected[1].items[0]), '키위 파이(밀, 키위)');
});

test('filterActiveStudents: inactive or other school year excluded, empty year included', () => {
  const list = [
    student({ name: 'a', active: false }),
    student({ name: 'b', schoolYear: 2025 }),
    student({ name: 'c', schoolYear: '' }),
    student({ name: 'd' }),
  ];
  assert.deepEqual(core.filterActiveStudents(list, 2026).map((s) => s.name), ['c', 'd']);
});

test('checkPeriod groups by date/mealType and honors allowed meal types', () => {
  const students = [student({ codes: '1' })];
  const menus = [
    menu({ date: '2026-09-02', name: '계란찜', codes: '1' }),
    menu({ date: '2026-09-01', name: '계란국', codes: '1' }),
    menu({ date: '2026-09-01', mealType: '석식', name: '계란말이', codes: '1' }),
  ];
  const r = core.checkPeriod(students, menus, ['중식']);
  assert.deepEqual(Object.keys(r), ['2026-09-01', '2026-09-02']);
  assert.deepEqual(Object.keys(r['2026-09-01']), ['중식']);
  assert.equal(r['2026-09-01']['중식'].affected.length, 1);
  const summary = core.summarizePeriod(r);
  assert.deepEqual(summary[0], { date: '2026-09-01', affectedCount: 1, uncheckedCount: 0, manualProtected: false, mealTypes: ['중식'] });
});

test('formatStudentLabel / studentKey', () => {
  const s = student();
  assert.equal(core.formatStudentLabel(s), '3-2 홍길동');
  assert.equal(core.studentKey(s), '2026|3|2|홍길동');
  assert.equal(core.studentKey(student({ name: '홍 길동' })), '2026|3|2|홍길동');
  const sorted = core.sortStudents([student({ name: '나' }), student({ grade: 1, name: '다' }), student({ name: '가' })]);
  assert.deepEqual(sorted.map((x) => x.grade + x.name), ['1다', '3가', '3나']);
});
