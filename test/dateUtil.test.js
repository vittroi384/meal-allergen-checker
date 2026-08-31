'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./helpers/loadCore');

const core = loadCore();

test('isValidDateStr', () => {
  assert.equal(core.isValidDateStr('2026-09-01'), true);
  assert.equal(core.isValidDateStr('2026-02-30'), false);
  assert.equal(core.isValidDateStr('20260901'), false);
  assert.equal(core.isValidDateStr(''), false);
});

test('toYmd / fromYmd', () => {
  assert.equal(core.toYmd('2026-09-01'), '20260901');
  assert.equal(core.fromYmd('20260901'), '2026-09-01');
  assert.equal(core.fromYmd(20260901), '2026-09-01');
});

test('addDays crosses month/year boundaries', () => {
  assert.equal(core.addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(core.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(core.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(core.addDays('2028-03-01', -1), '2028-02-29');
});

test('dayOfWeek / isWeekend / weekRange', () => {
  assert.equal(core.dayOfWeek('2026-08-31'), 1); // 월
  assert.equal(core.isWeekend('2026-09-05'), true);
  assert.deepEqual(core.weekRange('2026-09-02'), { start: '2026-08-31', end: '2026-09-06' });
  assert.deepEqual(core.weekRange('2026-09-06'), { start: '2026-08-31', end: '2026-09-06' }); // 일요일
  assert.deepEqual(core.weekRange('2026-08-31'), { start: '2026-08-31', end: '2026-09-06' }); // 월요일
});

test('monthRange / addMonths / eachDay', () => {
  assert.deepEqual(core.monthRange('2026-02'), { start: '2026-02-01', end: '2026-02-28' });
  assert.deepEqual(core.monthRange('2028-02'), { start: '2028-02-01', end: '2028-02-29' });
  assert.equal(core.addMonths('2026-12', 1), '2027-01');
  assert.equal(core.addMonths('2026-01', -1), '2025-12');
  assert.equal(core.eachDay('2026-08-30', '2026-09-02').length, 4);
});

test('calcSchoolYear: 3월 기준, override 우선', () => {
  assert.equal(core.calcSchoolYear('2026-08-31'), 2026);
  assert.equal(core.calcSchoolYear('2027-02-15'), 2026);
  assert.equal(core.calcSchoolYear('2027-03-01'), 2027);
  assert.equal(core.calcSchoolYear('2026-08-31', '2025'), 2025);
  assert.equal(core.calcSchoolYear('2026-08-31', ''), 2026);
  assert.equal(core.calcSchoolYear('2026-08-31', 'abc'), 2026);
});

test('formatKoreanDate', () => {
  assert.equal(core.formatKoreanDate('2026-09-01'), '9/1(화)');
  assert.equal(core.formatKoreanDate('2026-09-01', true), '2026년 9/1(화)');
  assert.equal(core.formatKoreanDateLong('2026-09-01'), '2026년 9월 1일 (화)');
});

test('parseTimeHHmm', () => {
  assert.deepEqual(core.parseTimeHHmm('07:30'), { hour: 7, minute: 30 });
  assert.deepEqual(core.parseTimeHHmm(' 7:05 '), { hour: 7, minute: 5 });
  assert.equal(core.parseTimeHHmm('24:00'), null);
  assert.equal(core.parseTimeHHmm('0730'), null);
});

test('nextMealDate skips days without meals', () => {
  const dates = ['2026-09-01', '2026-09-02', '2026-09-07'];
  assert.equal(core.nextMealDate('2026-08-31', dates), '2026-09-01');
  assert.equal(core.nextMealDate('2026-09-04', dates), '2026-09-07'); // 금 → 월
  assert.equal(core.nextMealDate('2026-09-07', dates), null);
});
