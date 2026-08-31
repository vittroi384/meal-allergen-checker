'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./helpers/loadCore');

const core = loadCore();

test('tableToObjects maps by header name regardless of column order, skips empty rows', () => {
  const values = [
    ['이름', '학년', '반', '번호', '알레르기코드'],
    ['홍길동', 3, 2, 15, '1, 6'],
    ['', '', '', '', ''],
    [' 김영희 ', '1', '1', '1', ''],
  ];
  const rows = core.tableToObjects(values, core.FIELD_MAP.STUDENTS);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]._row, 2);
  assert.equal(rows[0].name, '홍길동');
  assert.equal(rows[0].grade, 3);
  assert.equal(rows[1].name, '김영희');
  assert.equal(rows[1]._row, 4);
});

test('objectsToTable follows header order and fills missing with empty', () => {
  const t = core.objectsToTable([{ name: 'A', grade: 1 }], ['학년', '이름', '비고'], core.FIELD_MAP.STUDENTS);
  assert.deepEqual(t, [[1, 'A', '']]);
});

test('detectHeaderRow', () => {
  assert.equal(core.detectHeaderRow(['학년', '반', '번호', '이름'], ['학년', '반', '번호', '이름']), true);
  assert.equal(core.detectHeaderRow([3, 2, 15, '홍길동'], ['학년', '반', '번호', '이름']), false);
});

test('parseTsv handles CRLF and trailing blank lines', () => {
  const t = core.parseTsv('학년\t반\r\n3\t2\r\n\r\n');
  assert.deepEqual(t, [['학년', '반'], ['3', '2']]);
});

test('toBool', () => {
  assert.equal(core.toBool(true), true);
  assert.equal(core.toBool('TRUE'), true);
  assert.equal(core.toBool('예'), true);
  assert.equal(core.toBool('아니오'), false);
  assert.equal(core.toBool('', true), true);
  assert.equal(core.toBool(undefined), false);
});

test('cellToDateStr accepts Date, dotted, slashed, compact strings', () => {
  assert.equal(core.cellToDateStr(new Date(2026, 8, 1)), '2026-09-01');
  assert.equal(core.cellToDateStr('2026.9.1'), '2026-09-01');
  assert.equal(core.cellToDateStr('2026/09/01'), '2026-09-01');
  assert.equal(core.cellToDateStr('20260901'), '2026-09-01');
  assert.equal(core.cellToDateStr('9월 1일'), '');
});

test('splitList', () => {
  assert.deepEqual(core.splitList(' 키위, 망고 ,,복숭아'), ['키위', '망고', '복숭아']);
  assert.deepEqual(core.splitList(''), []);
  assert.deepEqual(core.splitList(null), []);
});
