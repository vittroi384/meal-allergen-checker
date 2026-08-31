'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadCore } = require('./helpers/loadCore');

const core = loadCore();
const fixture = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));

test('parseDishItem: standard NEIS forms', () => {
  assert.deepEqual(core.parseDishItem('소고기감자국 (5.6.16)'), { name: '소고기감자국', codes: [5, 6, 16], raw: '소고기감자국 (5.6.16)' });
  assert.deepEqual(core.parseDishItem('돈까스 (1.5.6.10.)').codes, [1, 5, 6, 10]);
  assert.deepEqual(core.parseDishItem('참외 ').codes, []);
  assert.equal(core.parseDishItem('참외 ').name, '참외');
  assert.equal(core.parseDishItem('새우까스/소스 (1.5.6.9)').name, '새우까스/소스');
});

test('parseDishItem: variant forms', () => {
  assert.deepEqual(core.parseDishItem('돈까스(1,5,6)').codes, [1, 5, 6]);
  assert.deepEqual(core.parseDishItem('돈까스（1.5.6）').codes, [1, 5, 6]);
  assert.deepEqual(core.parseDishItem('돈까스 (1)(5)(6)').codes, [1, 5, 6]);
  assert.deepEqual(core.parseDishItem('배추김치 5.9.13.').codes, [5, 9, 13]);
  assert.equal(core.parseDishItem('배추김치 5.9.13.').name, '배추김치');
  assert.deepEqual(core.parseDishItem('*돈까스* (6)').name, '돈까스');
  assert.deepEqual(core.parseDishItem('우유 (2)').codes, [2]);
});

test('parseDishItem: does not strip numbers that are part of a name', () => {
  assert.equal(core.parseDishItem('비타500').name, '비타500');
  assert.deepEqual(core.parseDishItem('비타500').codes, []);
  assert.equal(core.parseDishItem('1등급 한우국 (16)').name, '1등급 한우국');
  assert.deepEqual(core.parseDishItem('1등급 한우국 (16)').codes, [16]);
});

test('parseDishItem: out-of-range numbers are dropped, codes deduped/sorted', () => {
  assert.deepEqual(core.parseDishItem('이상한메뉴 (6.25.1.6)').codes, [1, 6]);
});

test('parseDishString splits on <br/> variants and newlines', () => {
  const dishes = core.parseDishString('현미찹쌀밥 <br/>소고기감자국 (5.6.16)<br>참외 <br />우유 (2)\n요구르트 (2)');
  assert.deepEqual(dishes.map((d) => d.name), ['현미찹쌀밥', '소고기감자국', '참외', '우유', '요구르트']);
  assert.deepEqual(dishes[1].codes, [5, 6, 16]);
  assert.deepEqual(core.parseDishString(''), []);
  assert.deepEqual(core.parseDishString(null), []);
});

test('parseMealResponse on real fixture', () => {
  const r = core.parseMealResponse(fixture('neis-meal-sample.json'));
  assert.equal(r.ok, true);
  assert.equal(r.code, 'INFO-000');
  assert.equal(r.total, 21);
  assert.equal(r.meals.length, 3);
  assert.equal(r.meals[0].date, '2026-06-01');
  assert.equal(r.meals[0].mealType, '중식');
  assert.equal(r.meals[0].dishes.length, 7);
  assert.deepEqual(r.meals[0].dishes[2], { name: '미트볼케첩볶음', codes: [2, 5, 6, 10, 12], raw: '미트볼케첩볶음 (2.5.6.10.12)' });
  assert.deepEqual(r.meals[0].dishes[5], { name: '참외', codes: [], raw: '참외' });
  assert.equal(r.meals[0].calories, '701.5 Kcal');
});

test('flattenMeals produces sheet rows', () => {
  const r = core.parseMealResponse(fixture('neis-meal-sample.json'));
  const rows = core.flattenMeals(r.meals);
  assert.equal(rows.length, 7 + 8 + 7);
  assert.deepEqual(rows[1], { date: '2026-06-01', mealType: '중식', name: '소고기감자국', codes: [5, 6, 16], raw: '소고기감자국 (5.6.16)' });
});

test('parseMealResponse: no data envelope', () => {
  const r = core.parseMealResponse(fixture('neis-nodata.json'));
  assert.equal(r.ok, false);
  assert.equal(r.noData, true);
  assert.equal(r.code, 'INFO-200');
  assert.deepEqual(r.meals, []);
});

test('parseMealResponse: error envelope and garbage', () => {
  const r = core.parseMealResponse({ RESULT: { CODE: 'ERROR-290', MESSAGE: '' } });
  assert.equal(r.ok, false);
  assert.equal(r.noData, false);
  assert.ok(r.message.includes('인증키'));
  assert.equal(core.parseMealResponse(null).code, 'PARSE');
  assert.equal(core.parseMealResponse({ foo: 1 }).code, 'PARSE');
});

test('parseSchoolResponse on real fixture', () => {
  const r = core.parseSchoolResponse(fixture('neis-school-sample.json'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.schools[0], {
    atptCode: 'B10', atptName: '서울특별시교육청', schoolCode: '7091380', name: '서울대치초등학교', kind: '초등학교', address: '서울특별시 강남구 양재천로 363',
  });
});

test('buildMealUrl / buildSchoolSearchUrl encode params and omit empties', () => {
  const u = core.buildMealUrl({ key: 'K', atptCode: 'B10', schoolCode: '7091380', from: '2026-09-01', to: '2026-09-30', mealCode: '2' });
  assert.equal(u, 'https://open.neis.go.kr/hub/mealServiceDietInfo?KEY=K&Type=json&pIndex=1&pSize=1000&ATPT_OFCDC_SC_CODE=B10&SD_SCHUL_CODE=7091380&MMEAL_SC_CODE=2&MLSV_FROM_YMD=20260901&MLSV_TO_YMD=20260930');
  const u2 = core.buildMealUrl({ key: 'K', atptCode: 'B10', schoolCode: '7091380', from: '2026-09-01', to: '2026-09-30' });
  assert.ok(!u2.includes('MMEAL_SC_CODE'));
  const s = core.buildSchoolSearchUrl({ key: 'K', name: '대치초' });
  assert.ok(s.includes('SCHUL_NM=' + encodeURIComponent('대치초')));
  assert.ok(!s.includes('ATPT_OFCDC_SC_CODE'));
});
