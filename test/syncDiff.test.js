'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./helpers/loadCore');

const core = loadCore();
const range = { start: '2026-09-01', end: '2026-09-30' };

const ex = (row, date, name, codes, over) =>
  core.normalizeMenu(Object.assign({ _row: row, date, mealType: '중식', name, codes, source: 'NEIS', manualEdited: false }, over));
const fe = (date, name, codes) => ({ date, mealType: '중식', name, codes: core.parseAllergyCodes(codes), raw: name + ' (' + codes + ')' });

test('unchanged meal produces no writes', () => {
  const plan = core.calcSyncPlan([ex(2, '2026-09-01', '쌀밥', ''), ex(3, '2026-09-01', '돈까스', '1,5,6,10')],
    [fe('2026-09-01', '돈까스', '1.5.6.10'), fe('2026-09-01', '쌀밥', '')], range, ['중식']);
  assert.deepEqual(plan.deleteRows, []);
  assert.deepEqual(plan.insertRows, []);
  assert.equal(plan.stats.mealsUnchanged, 1);
});

test('changed meal is replaced; deleteRows descending', () => {
  const plan = core.calcSyncPlan([ex(2, '2026-09-01', '쌀밥', ''), ex(3, '2026-09-01', '돈까스', '1,5,6,10')],
    [fe('2026-09-01', '쌀밥', ''), fe('2026-09-01', '치킨까스', '1.5.6.15')], range, ['중식']);
  assert.deepEqual(plan.deleteRows, [3, 2]);
  assert.equal(plan.insertRows.length, 2);
  assert.equal(plan.insertRows[1].name, '치킨까스');
  assert.equal(plan.insertRows[1].codes, '1,5,6,15');
  assert.equal(plan.insertRows[1].source, 'NEIS');
  assert.equal(plan.insertRows[1].manualEdited, false);
  assert.equal(plan.stats.mealsReplaced, 1);
});

test('new meal inserted, vanished meal removed', () => {
  const plan = core.calcSyncPlan([ex(2, '2026-09-01', '쌀밥', '')], [fe('2026-09-02', '비빔밥', '1.5.6')], range, ['중식']);
  assert.deepEqual(plan.deleteRows, [2]);
  assert.equal(plan.insertRows.length, 1);
  assert.equal(plan.stats.mealsInserted, 1);
  assert.equal(plan.stats.mealsRemoved, 1);
});

test('manually edited meal is protected as a whole', () => {
  const plan = core.calcSyncPlan(
    [ex(2, '2026-09-01', '쌀밥', ''), ex(3, '2026-09-01', '돈까스', '6,10', { manualEdited: true })],
    [fe('2026-09-01', '쌀밥', ''), fe('2026-09-01', '치킨까스', '15')], range, ['중식']);
  assert.deepEqual(plan.deleteRows, []);
  assert.deepEqual(plan.insertRows, []);
  assert.deepEqual(plan.protectedMeals, ['2026-09-01|중식']);
  assert.equal(plan.stats.mealsProtected, 1);
});

test('manual-source rows protect the meal even without the flag', () => {
  const plan = core.calcSyncPlan([ex(2, '2026-09-01', '특식', '', { source: '수동' })], [fe('2026-09-01', '쌀밥', '')], range, ['중식']);
  assert.deepEqual(plan.protectedMeals, ['2026-09-01|중식']);
});

test('rows outside range or meal type are ignored', () => {
  const plan = core.calcSyncPlan(
    [ex(2, '2026-08-31', '쌀밥', ''), ex(3, '2026-09-01', '조식밥', '', { mealType: '조식' })],
    [fe('2026-10-01', '쌀밥', '')], range, ['중식']);
  assert.deepEqual(plan.deleteRows, []);
  assert.deepEqual(plan.insertRows, []);
  assert.equal(plan.stats.mealsFetched, 0);
});

test('calcRevertPlan deletes all rows for the meal and reinserts NEIS rows', () => {
  const plan = core.calcRevertPlan(
    [ex(2, '2026-09-01', '쌀밥', ''), ex(3, '2026-09-01', '수동메뉴', '6', { manualEdited: true }), ex(4, '2026-09-02', '국', '')],
    [fe('2026-09-01', '쌀밥', ''), fe('2026-09-01', '돈까스', '6.10'), fe('2026-09-02', '국', '')],
    '2026-09-01', '중식');
  assert.deepEqual(plan.deleteRows, [3, 2]);
  assert.deepEqual(plan.insertRows.map((r) => r.name), ['쌀밥', '돈까스']);
});

test('validateMealImportRows + calcMealImportPlan', () => {
  const v = core.validateMealImportRows(
    [
      { _row: 2, date: '2026.9.1', mealType: '중식', name: '쌀밥', codes: '-' },
      { _row: 3, date: '2026-09-01', mealType: '중식', name: '돈까스', codes: '6,10' },
      { _row: 4, date: '2026-10-01', mealType: '중식', name: '밖', codes: '' },
      { _row: 5, date: '2026-09-02', mealType: '간식', name: '', codes: '1,30' },
    ],
    range,
  );
  assert.equal(v.ok, false);
  assert.equal(v.errorCount, 2);
  assert.ok(v.rows[2].errors[0].includes('월 밖'));
  assert.equal(v.rows[3].errors.length, 3);

  const good = v.rows.filter((r) => !r.errors.length).map((r) => r.menu);
  const plan = core.calcMealImportPlan([ex(2, '2026-09-01', '옛메뉴', ''), ex(3, '2026-09-03', '유지', '')], good);
  assert.deepEqual(plan.deleteRows, [2]);
  assert.deepEqual(plan.replacedMeals, ['2026-09-01|중식']);
  assert.equal(plan.insertRows[0].codes, '-');
  assert.equal(plan.insertRows[1].codes, '6,10');
  assert.equal(plan.insertRows[1].source, '수동');
  assert.equal(plan.insertRows[1].manualEdited, true);
});
