/**
 * NEIS 재동기화 계획 계산. 순수 함수.
 * 끼니(날짜+식사구분) 단위로 보호/대체/유지를 결정한다.
 */

/** 끼니 식별키: '2026-09-01|중식' */
function mealKey(date, mealType) {
  return date + '|' + mealType;
}

// 끼니의 메뉴 구성을 비교용 문자열로: '이름#코드' 를 정렬해 이어붙임 → 행 순서가 달라도 같은 구성이면 동일
function _menuSignature(rows) {
  return rows
    .map(function (r) { return r.name + '#' + formatAllergyCodes(r.codes); })
    .sort()
    .join('\n');
}

/**
 * @param existingRows normalizeMenu 된 기존 급식 행 (_row 포함, 전체)
 * @param fetchedRows  NEIS 에서 받은 정규화 행 [{date, mealType, name, codes, raw}]
 * @param range { start, end } 'yyyy-MM-dd' 동기화 대상 기간
 * @param mealTypes 관리할 끼니 배열
 * @returns {
 *   deleteRows: number[]        // 삭제할 시트 행 번호 (내림차순)
 *   insertRows: object[]        // 새로 넣을 행 (source=NEIS, manualEdited=false)
 *   protectedMeals: string[]    // 'date|mealType' 수동 보호로 건너뛴 끼니
 *   stats: { mealsFetched, mealsInserted, mealsReplaced, mealsUnchanged, mealsRemoved, mealsProtected }
 * }
 */
function calcSyncPlan(existingRows, fetchedRows, range, mealTypes) {
  var allowed = mealTypes && mealTypes.length ? mealTypes : MEAL_TYPES;
  var inScope = function (r) {
    return r.date >= range.start && r.date <= range.end && allowed.indexOf(r.mealType) >= 0;
  };

  var existingByMeal = {};
  existingRows.filter(inScope).forEach(function (r) {
    var k = mealKey(r.date, r.mealType);
    (existingByMeal[k] = existingByMeal[k] || []).push(r);
  });
  var fetchedByMeal = {};
  fetchedRows.filter(inScope).forEach(function (r) {
    var k = mealKey(r.date, r.mealType);
    (fetchedByMeal[k] = fetchedByMeal[k] || []).push(r);
  });

  var deleteRows = [];
  var insertRows = [];
  var protectedMeals = [];
  var stats = { mealsFetched: 0, mealsInserted: 0, mealsReplaced: 0, mealsUnchanged: 0, mealsRemoved: 0, mealsProtected: 0 };

  var allKeys = {};
  Object.keys(existingByMeal).forEach(function (k) { allKeys[k] = true; });
  Object.keys(fetchedByMeal).forEach(function (k) { allKeys[k] = true; });
  stats.mealsFetched = Object.keys(fetchedByMeal).length;

  Object.keys(allKeys).sort().forEach(function (k) {
    var ex = existingByMeal[k] || [];
    var fe = fetchedByMeal[k] || [];
    var isProtected = ex.some(function (r) { return r.manualEdited || r.source === SOURCES.MANUAL; });
    if (isProtected) {
      protectedMeals.push(k);
      stats.mealsProtected++;
      return;
    }
    if (!fe.length) {
      // NEIS 에서 사라진 끼니 → 기존 NEIS 행 삭제
      ex.forEach(function (r) { deleteRows.push(r._row); });
      stats.mealsRemoved++;
      return;
    }
    if (ex.length && _menuSignature(ex) === _menuSignature(fe)) {
      stats.mealsUnchanged++;
      return;
    }
    ex.forEach(function (r) { deleteRows.push(r._row); });
    fe.forEach(function (r) {
      insertRows.push({
        date: r.date, mealType: r.mealType, name: r.name,
        codes: formatAllergyCodes(r.codes), source: SOURCES.NEIS, manualEdited: false, raw: r.raw || '',
      });
    });
    if (ex.length) stats.mealsReplaced++; else stats.mealsInserted++;
  });

  deleteRows.sort(function (a, b) { return b - a; });
  return { deleteRows: deleteRows, insertRows: insertRows, protectedMeals: protectedMeals, stats: stats };
}

/**
 * "NEIS 데이터로 되돌리기": 특정 끼니의 모든 기존 행 삭제 + NEIS 행 삽입 계획.
 */
function calcRevertPlan(existingRows, fetchedRows, date, mealType) {
  var deleteRows = existingRows
    .filter(function (r) { return r.date === date && r.mealType === mealType; })
    .map(function (r) { return r._row; })
    .sort(function (a, b) { return b - a; });
  var insertRows = fetchedRows
    .filter(function (r) { return r.date === date && r.mealType === mealType; })
    .map(function (r) {
      return { date: r.date, mealType: r.mealType, name: r.name, codes: formatAllergyCodes(r.codes),
        source: SOURCES.NEIS, manualEdited: false, raw: r.raw || '' };
    });
  return { deleteRows: deleteRows, insertRows: insertRows };
}

/**
 * xlsx 급식 가져오기 계획: 파일에 있는 (날짜,끼니)만 대체. 가져온 행은 수동/보호.
 * @param importedRows 검증 완료된 정규화 행
 */
function calcMealImportPlan(existingRows, importedRows) {
  var keys = {};
  importedRows.forEach(function (r) { keys[mealKey(r.date, r.mealType)] = true; });
  var deleteRows = existingRows
    .filter(function (r) { return keys[mealKey(r.date, r.mealType)]; })
    .map(function (r) { return r._row; })
    .sort(function (a, b) { return b - a; });
  var insertRows = importedRows.map(function (r) {
    return { date: r.date, mealType: r.mealType, name: r.name,
      codes: r.checkedNone ? CODES_CHECKED_NONE : formatAllergyCodes(r.codes),
      source: SOURCES.MANUAL, manualEdited: true, raw: r.raw || '' };
  });
  return { deleteRows: deleteRows, insertRows: insertRows, replacedMeals: Object.keys(keys).sort() };
}

/**
 * 급식 xlsx 행 검증. rawRows 는 tableToObjects(FIELD_MAP.MEALS) 결과.
 * @param range 선택한 월 { start, end } — 벗어나면 오류
 */
function validateMealImportRows(rawRows, range) {
  var rows = rawRows.map(function (raw) {
    var errors = [];
    var date = cellToDateStr(raw.date);
    if (!date || !isValidDateStr(date)) errors.push('날짜 형식 오류');
    else if (range && (date < range.start || date > range.end)) errors.push('선택한 월 밖의 날짜');
    var mealType = String(raw.mealType || '').trim();
    if (MEAL_TYPES.indexOf(mealType) < 0) errors.push('식사구분은 조식/중식/석식');
    var name = String(raw.name || '').trim();
    if (!name) errors.push('메뉴명 없음');
    var cv = validateCodesCell(raw.codes);
    if (cv.invalid.length) errors.push('알레르기코드 범위 밖: ' + cv.invalid.join(','));
    var checkedNone = String(raw.codes === undefined || raw.codes === null ? '' : raw.codes).trim() === CODES_CHECKED_NONE;
    return {
      _row: raw._row, errors: errors,
      menu: { date: date, mealType: mealType, name: name, codes: cv.codes, checkedNone: checkedNone, raw: String(raw.raw || '') },
    };
  });
  var errorCount = rows.filter(function (r) { return r.errors.length; }).length;
  return { ok: errorCount === 0, rows: rows, errorCount: errorCount };
}
