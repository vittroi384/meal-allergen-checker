/**
 * 급식 관리 API: 수동 입력/수정/삭제, 확인 처리, NEIS 되돌리기, 동기화, 월 xlsx 가져오기.
 */

/**
 * 메뉴 저장. m = { _row?, date, mealType, name, codes: number[], checkedNone: boolean }
 * 수정/추가 모두 수동수정여부=TRUE (해당 끼니는 이후 동기화에서 보호됨).
 */
function apiSaveMenu(token, m) {
  requireSession(token);
  if (!isValidDateStr(m.date)) throw new Error('날짜 형식 오류');
  if (MEAL_TYPES.indexOf(m.mealType) < 0) throw new Error('식사구분 오류');
  var name = String(m.name || '').trim();
  if (!name) throw new Error('메뉴명을 입력하세요');
  var codes = parseAllergyCodes(m.codes || []);
  var codesStr = codes.length ? formatAllergyCodes(codes) : (m.checkedNone ? CODES_CHECKED_NONE : '');
  if (m._row) {
    var existing = readMeals_().filter(function (x) { return x._row === m._row; })[0];
    if (!existing) throw new Error('수정할 메뉴를 찾지 못했습니다. 새로고침 후 다시 시도하세요');
    var checkedAt = codesStr === CODES_CHECKED_NONE ? (existing.checkedNone && existing.checkedAt ? existing.checkedAt : nowStr_().slice(0, 16)) : '';
    updateObjectRow_(SHEETS.MEALS, m._row, HEADERS.MEALS, FIELD_MAP.MEALS,
      { date: m.date, mealType: m.mealType, name: name, codes: codesStr, manualEdited: true, checkedAt: checkedAt });
  } else {
    appendMeals_([{ date: m.date, mealType: m.mealType, name: name, codes: codesStr, source: SOURCES.MANUAL, manualEdited: true, raw: '', checkedAt: codesStr === CODES_CHECKED_NONE ? nowStr_().slice(0, 16) : '' }]);
  }
  _protectMeal(m.date, m.mealType);
  return { ok: true };
}

/** 같은 끼니의 나머지 행도 수동수정여부=TRUE 로 (끼니 단위 보호 일관성). 열 전체를 한 번에 읽고 한 번에 쓴다. */
function _protectMeal(date, mealType) {
  var sheet = getSheet_(SHEETS.MEALS);
  var col = headerIndex_(sheet)['수동수정여부'];
  var n = sheet.getLastRow() - 1;
  if (!col || n < 1) return;
  var rows = {};
  readMeals_().forEach(function (r) { if (r.date === date && r.mealType === mealType && !r.manualEdited) rows[r._row] = true; });
  if (!Object.keys(rows).length) return;
  var range = sheet.getRange(2, col, n, 1);
  var vals = range.getValues();
  Object.keys(rows).forEach(function (r) { vals[Number(r) - 2][0] = true; });
  range.setValues(vals);
  bumpDataVersion_();
}

function apiDeleteMenu(token, row) {
  requireSession(token);
  var target = readMeals_().filter(function (x) { return x._row === row; })[0];
  if (!target) throw new Error('삭제할 메뉴를 찾지 못했습니다');
  deleteMealRows_([row]);
  _protectMeal(target.date, target.mealType);
  return { ok: true };
}

/** 확인 처리: checked=true → 알레르기코드 '-' (없음 확인됨), false → 빈칸(다시 확인 필요) */
function apiMarkMenuChecked(token, row, checked) {
  requireSession(token);
  var target = readMeals_().filter(function (x) { return x._row === row; })[0];
  if (!target) throw new Error('메뉴를 찾지 못했습니다');
  if (target.codes.length) throw new Error('알레르기 코드가 있는 메뉴는 확인 처리 대상이 아닙니다');
  // 확인 시각은 문자열로 기록 (시트가 날짜로 자동 변환해도 읽을 때 cellToDateTimeStr_ 로 복원)
  updateObjectRow_(SHEETS.MEALS, row, HEADERS.MEALS, FIELD_MAP.MEALS, { codes: checked ? CODES_CHECKED_NONE : '', manualEdited: true, checkedAt: checked ? nowStr_().slice(0, 16) : '' });
  _protectMeal(target.date, target.mealType);
  return { ok: true };
}

function apiRevertMeal(token, date, mealType) {
  requireSession(token);
  return revertMealToNeis_(date, mealType);
}

function apiSyncMonths(token, months) {
  requireSession(token);
  var list = (months || []).filter(function (m) { return /^\d{4}-\d{2}$/.test(m); });
  if (!list.length) throw new Error('동기화할 월을 선택하세요');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('다른 동기화가 진행 중입니다. 잠시 후 다시 시도하세요');
  try {
    return runSyncMonths_(list, { notify: false });
  } finally {
    lock.releaseLock();
  }
}

/** 급식 관리 화면용 월 요약: 데이터 있는 날 수, 보호 끼니, 확인 필요 메뉴 */
function apiMealsOverview(token, ym) {
  requireSession(token);
  var range = monthRange(ym);
  var meals = readMealsInRange_(range.start, range.end, MEAL_TYPES);
  var protectedMap = {};
  var dates = {};
  meals.forEach(function (m) {
    dates[m.date] = true;
    if (m.manualEdited || m.source === SOURCES.MANUAL) protectedMap[mealKey(m.date, m.mealType)] = { date: m.date, mealType: m.mealType, label: formatKoreanDate(m.date) };
  });
  var unchecked = meals.filter(function (m) { return m.needsCheck; }).map(serializeMenu_);
  var allMonths = {};
  readMeals_().forEach(function (m) { if (m.date) allMonths[m.date.slice(0, 7)] = (allMonths[m.date.slice(0, 7)] || 0) + 1; });
  return {
    ym: ym, dayCount: Object.keys(dates).length, menuCount: meals.length,
    protectedMeals: Object.keys(protectedMap).sort().map(function (k) { return protectedMap[k]; }),
    unchecked: unchecked,
    months: Object.keys(allMonths).sort().map(function (k) { return { ym: k, count: allMonths[k] }; }),
    lastSync: lastSyncInfo_(),
  };
}

// ---------- xlsx 가져오기 ----------

/** @param input { base64, filename, ym } @returns { rawRows, rows:[{_row, errors, menu}], ok, errorCount, replacedMeals } */
function apiPreviewMealImport(token, input) {
  requireSession(token);
  if (!input || !input.base64) throw new Error('xlsx 파일을 선택하세요');
  if (!/^\d{4}-\d{2}$/.test(input.ym || '')) throw new Error('월을 선택하세요');
  var values = xlsxBase64ToValues_(input.base64, input.filename);
  if (!values.length || !detectHeaderRow(values[0], ['날짜', '식사구분', '메뉴명'])) {
    throw new Error('첫 행에 헤더(날짜, 식사구분, 메뉴명, 알레르기코드)가 있어야 합니다. "월 데이터 내보내기" 파일 형식을 사용하세요');
  }
  var rawRows = sanitizeRows_(tableToObjects(values, FIELD_MAP.MEALS));
  var v = validateMealImportRows(rawRows, monthRange(input.ym));
  var keys = {};
  v.rows.forEach(function (r) { if (!r.errors.length) keys[mealKey(r.menu.date, r.menu.mealType)] = true; });
  return { rawRows: rawRows, ok: v.ok, errorCount: v.errorCount, rows: v.rows, replacedMeals: Object.keys(keys).sort() };
}

function apiApplyMealImport(token, input) {
  requireSession(token);
  var v = validateMealImportRows(input.rawRows || [], monthRange(input.ym));
  if (!v.ok) return { ok: false, error: '오류 행 ' + v.errorCount + '건 — 반영하지 않았습니다' };
  var plan = calcMealImportPlan(readMeals_(), v.rows.map(function (r) { return r.menu; }));
  deleteMealRows_(plan.deleteRows);
  appendMeals_(plan.insertRows);
  sortMealsSheet_();
  appendLog_({ kind: NOTICE_KINDS.SYSTEM, summary: 'xlsx 급식 가져오기 ' + input.ym + ': ' + plan.replacedMeals.length + '개 끼니 대체, ' + plan.insertRows.length + '개 메뉴', ok: true });
  return { ok: true, replacedMeals: plan.replacedMeals.length, inserted: plan.insertRows.length };
}
