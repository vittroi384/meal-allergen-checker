'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./helpers/loadCore');

const core = loadCore();

const student = core.normalizeStudent({ schoolYear: 2026, grade: 3, classNo: 2, number: 15, name: '홍길동', codes: '6,10', keywords: '', active: true });
const menus = [
  core.normalizeMenu({ date: '2026-09-01', mealType: '중식', name: '쌀밥', codes: '-' }),
  core.normalizeMenu({ date: '2026-09-01', mealType: '중식', name: '돈까스', codes: '1,5,6,10' }),
  core.normalizeMenu({ date: '2026-09-01', mealType: '중식', name: '배추김치', codes: '' }),
];
const result = core.checkMeal([student], menus);

test('formatMenuLine', () => {
  assert.equal(core.formatMenuLine(menus[0]), '쌀밥');
  assert.equal(core.formatMenuLine(menus[1]), '돈까스 [난류(1), 대두(5), 밀(6), 돼지고기(10)]');
  assert.equal(core.formatMenuLine(menus[2]), '배추김치 [확인 필요]');
});

test('formatStaffDaily contains menus, affected students, unchecked menus, link', () => {
  const m = core.formatStaffDaily({ date: '2026-09-01', schoolName: '대치초', byType: { '중식': result }, webAppUrl: 'https://x/exec' });
  assert.equal(m.subject, '[대치초] 2026년 9/1(화) 급식 알레르기 안내 — 해당 1명');
  assert.ok(m.text.includes('3-2-15 홍길동 — 돈까스(밀, 돼지고기)'));
  assert.ok(m.text.includes('확인 필요): 배추김치'));
  assert.ok(m.text.includes('https://x/exec'));
  assert.ok(m.html.includes('<table'));
  assert.ok(m.html.includes('홍길동'));
  assert.equal(m.hasMeals, true);
  assert.equal(m.affectedCount, 1);
});

test('formatStaffDaily with no meals', () => {
  const m = core.formatStaffDaily({ date: '2026-09-05', schoolName: '대치초', byType: { '중식': core.checkMeal([student], []) } });
  assert.equal(m.hasMeals, false);
  assert.ok(m.text.includes('급식 데이터가 없습니다'));
});

test('formatStaffDaily escapes html', () => {
  const evil = core.normalizeMenu({ date: '2026-09-01', mealType: '중식', name: '<b>x</b>', codes: '6' });
  const m = core.formatStaffDaily({ date: '2026-09-01', byType: { '중식': core.checkMeal([student], [evil]) } });
  assert.ok(m.html.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(!m.html.includes('<b>x</b>'));
});

test('formatStaffWeekly', () => {
  const period = core.checkPeriod([student], menus, ['중식']);
  const m = core.formatStaffWeekly({ weekStart: '2026-08-31', weekEnd: '2026-09-06', schoolName: '대치초', period });
  assert.ok(m.subject.includes('8/31(월) ~ 9/6(일)'));
  assert.ok(m.text.includes('9/1(화) 중식 — 해당 1명, 확인 필요 1개'));
});

test('formatParentMessage: 내일 표기 and reasons', () => {
  const m = core.formatParentMessage({ schoolName: '대치초', date: '2026-09-01', mealType: '중식', student, items: result.affected[0].items, todayStr: '2026-08-31' });
  assert.equal(m.text, '[대치초] 내일(9/1) 중식에 홍길동 학생이 못 먹는 메뉴가 있습니다: 돈까스(밀, 돼지고기)');
  const m2 = core.formatParentMessage({ schoolName: '대치초', date: '2026-09-07', mealType: '중식', student, items: result.affected[0].items, todayStr: '2026-09-04' });
  assert.ok(m2.text.startsWith('[대치초] 9/7(월) 중식에'));
});

test('formatSyncResult', () => {
  const ok = core.formatSyncResult({ ok: true, schoolName: '대치초', months: ['2026-09', '2026-10'], stats: { mealsFetched: 40, mealsInserted: 40 }, uncheckedCount: 3 });
  assert.ok(ok.subject.includes('완료'));
  assert.ok(ok.text.includes('신규 40'));
  assert.ok(ok.text.includes('3개'));
  const bad = core.formatSyncResult({ ok: false, months: ['2026-09'], error: 'INFO-300 인증키 오류' });
  assert.ok(bad.subject.includes('실패'));
  assert.ok(bad.text.includes('INFO-300'));
});

test('calcDedupeKey / maskRecipient / calcSmsBytes / summarizeForLog', () => {
  assert.equal(core.calcDedupeKey('학부모', '2026-09-01', 'a@b.com', '2026|3|2|15'), '학부모|2026-09-01|a@b.com|2026|3|2|15');
  assert.equal(core.calcDedupeKey('담당자일일', '2026-09-01', 'a@b.com'), '담당자일일|2026-09-01|a@b.com|');
  assert.equal(core.maskRecipient('abcdef@x.com'), 'ab***@x.com');
  assert.equal(core.maskRecipient('010-1234-5678'), '010-****-5678');
  assert.equal(core.calcSmsBytes('abc'), 3);
  assert.equal(core.calcSmsBytes('한글a'), 5);
  assert.equal(core.summarizeForLog('a'.repeat(200)).length, 100);
});
