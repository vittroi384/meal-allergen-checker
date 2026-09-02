/**
 * NEIS → 급식 시트 동기화 (월간/일간/수동) 와 "NEIS 데이터로 되돌리기".
 * 계획 계산은 core/syncDiff.js, 여기서는 읽기 → 계획 → 쓰기만.
 */

/**
 * 여러 달 동기화.
 * @param yearMonths ['2026-09', '2026-10']
 * @param opts { notify: 결과를 담당자에게 알림, notifyOnError: 실패 시에만 알림 }
 * @returns { ok, months, stats, protectedMeals, uncheckedCount, error }
 */
function runSyncMonths_(yearMonths, opts) {
  var o = opts || {};
  var settings = readSettings();
  var mealTypes = managedMealTypes_(settings);
  var total = { mealsFetched: 0, mealsInserted: 0, mealsReplaced: 0, mealsUnchanged: 0, mealsRemoved: 0, mealsProtected: 0 };
  var protectedMeals = [];
  var result = { ok: true, months: yearMonths, stats: total, protectedMeals: protectedMeals, uncheckedCount: 0, error: '' };

  try {
    ensureSheet_(SHEETS.MEALS, HEADERS.MEALS);
    // 달 단위로 처리: NEIS 조회 → 기존 행과 비교(calcSyncPlan) → 삭제·삽입.
    // 수동 수정된 끼니는 calcSyncPlan 이 계획에서 제외해 보호하고, protectedMeals 로 보고만 한다.
    yearMonths.forEach(function (ym) {
      var range = monthRange(ym);
      var fetched = fetchMealsForRange_(range.start, range.end, mealTypes, settings);
      if (!fetched.ok) throw new Error(fetched.error);
      var existing = readMeals_();
      var plan = calcSyncPlan(existing, fetched.rows, range, mealTypes);
      deleteMealRows_(plan.deleteRows);
      appendMeals_(plan.insertRows);
      Object.keys(total).forEach(function (k) { total[k] += plan.stats[k] || 0; });
      plan.protectedMeals.forEach(function (k) { protectedMeals.push(k); });
      // 코드 없이 들어온 메뉴 = 담당자가 알레르기 정보를 직접 확인해야 하는 건수
      result.uncheckedCount += plan.insertRows.filter(function (r) { return !r.codes; }).length;
    });
    sortMealsSheet_();
    setState('LAST_SYNC_AT', nowStr_());
    setState('LAST_SYNC_RESULT', JSON.stringify({ ok: true, months: yearMonths, stats: total, at: nowStr_() }));
    appendLog_({ kind: NOTICE_KINDS.SYNC_RESULT, summary: '동기화 완료 ' + yearMonths.join(',') + ' ' + JSON.stringify(total), ok: true });
  } catch (e) {
    result.ok = false;
    result.error = String(e.message || e);
    setState('LAST_SYNC_RESULT', JSON.stringify({ ok: false, months: yearMonths, error: result.error, at: nowStr_() }));
    appendLog_({ kind: NOTICE_KINDS.SYNC_RESULT, summary: '동기화 실패 ' + yearMonths.join(','), ok: false, error: result.error });
  }

  if ((o.notify || (o.notifyOnError && !result.ok)) && typeof sendSyncResultNotice_ === 'function') {
    try { sendSyncResultNotice_(result); } catch (e) { logError_('sendSyncResultNotice_', e); }
  }
  return result;
}

/** 급식 시트를 날짜 → 식사구분 → 원래 순서로 정렬 (사람이 보기 좋게) */
function sortMealsSheet_() {
  var sheet = getSheet_(SHEETS.MEALS);
  var n = sheet.getLastRow() - 1;
  if (n < 2) return;
  var idx = headerIndex_(sheet);
  var dateCol = idx['날짜'], typeCol = idx['식사구분'];
  if (!dateCol || !typeCol) return;
  sheet.getRange(2, 1, n, sheet.getLastColumn()).sort([{ column: dateCol, ascending: true }, { column: typeCol, ascending: true }]);
}

/**
 * 특정 끼니를 NEIS 데이터로 되돌린다 (수동 행 포함 전부 삭제 후 재삽입).
 * @returns { ok, inserted, error }
 */
function revertMealToNeis_(date, mealType) {
  var settings = readSettings();
  var fetched = fetchMealsForRange_(date, date, [mealType], settings);
  if (!fetched.ok) return { ok: false, inserted: 0, error: fetched.error };
  var plan = calcRevertPlan(readMeals_(), fetched.rows, date, mealType);
  deleteMealRows_(plan.deleteRows);
  appendMeals_(plan.insertRows);
  sortMealsSheet_();
  appendLog_({ kind: NOTICE_KINDS.SYSTEM, summary: 'NEIS 로 되돌림 ' + date + ' ' + mealType + ' (' + plan.insertRows.length + '개 메뉴)', ok: true });
  return { ok: true, inserted: plan.insertRows.length, error: fetched.noData ? 'NEIS 에 해당 날짜 데이터가 없어 비워졌습니다' : '' };
}

/** 마지막 동기화 정보 (대시보드용) */
function lastSyncInfo_() {
  var raw = getState('LAST_SYNC_RESULT');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}
