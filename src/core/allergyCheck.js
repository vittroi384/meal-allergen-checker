/**
 * 알레르기 코드 정규화 + 학생 × 메뉴 판별. 순수 함수.
 */

/**
 * '1, 5.6' / '1.5.6.' / [1,5,6] / '(1.5.6)' → [1,5,6] (정렬·중복 제거). 범위 밖 숫자는 버린다.
 * CODES_CHECKED_NONE('-') 이면 [].
 */
function parseAllergyCodes(input) {
  if (input === null || input === undefined) return [];
  if (Array.isArray(input)) {
    return _uniqSortedCodes(input.map(Number));
  }
  var s = String(input).trim();
  if (s === '' || s === CODES_CHECKED_NONE) return [];
  // 구분자 종류와 무관하게 숫자 덩어리만 추출: '1, 5.6' → ['1','5','6']
  var nums = s.match(/\d+/g) || [];
  return _uniqSortedCodes(nums.map(Number));
}

// 1~19 범위 밖 숫자와 중복을 버리고 오름차순 정렬 (parseAllergyCodes 전용 헬퍼)
function _uniqSortedCodes(nums) {
  var seen = {};
  var out = [];
  nums.forEach(function (n) {
    if (!Number.isInteger(n) || n < ALLERGEN_MIN || n > ALLERGEN_MAX) return;
    if (seen[n]) return;
    seen[n] = true;
    out.push(n);
  });
  return out.sort(function (a, b) { return a - b; });
}

/** [1,5,6] → '1,5,6' */
function formatAllergyCodes(codes) {
  return (codes || []).join(',');
}

/** [1,6] → ['난류','밀'] */
function allergenNames(codes) {
  return (codes || []).map(function (c) { return ALLERGENS[c] || String(c); });
}

/** [1,6] → '난류(1), 밀(6)' */
function formatAllergenTags(codes) {
  return (codes || []).map(function (c) { return (ALLERGENS[c] || '?') + '(' + c + ')'; }).join(', ');
}

/** 키워드 비교용 정규화: 공백 제거, 소문자 */
function _normKeyword(s) {
  return String(s || '').replace(/\s+/g, '').toLowerCase();
}

/** 기타알레르기 셀 → 키워드 배열 */
function parseKeywords(input) {
  if (Array.isArray(input)) return input.map(function (k) { return String(k).trim(); }).filter(Boolean);
  return splitList(input);
}

/**
 * 설정 '기타알레르기목록' 파싱: '키위=골드키위,그린키위; 망고; 복숭아=천도복숭아' (세미콜론/줄바꿈 구분)
 * @returns [{ word, synonyms: string[] }]
 */
function parseKeywordList(text) {
  var out = [];
  var seen = {};
  String(text === undefined || text === null ? '' : text).split(/[;\n]/).forEach(function (part) {
    var p = part.trim();
    if (!p) return;
    var eq = p.indexOf('=');
    var word = (eq >= 0 ? p.slice(0, eq) : p).trim();
    if (!word) return;
    var synonyms = eq >= 0 ? splitList(p.slice(eq + 1)).filter(function (s) { return _normKeyword(s) !== _normKeyword(word); }) : [];
    var nk = _normKeyword(word);
    if (seen[nk]) return;
    seen[nk] = true;
    out.push({ word: word, synonyms: synonyms });
  });
  return out;
}

/** [{word, synonyms}] → 설정 문자열 */
function formatKeywordList(list) {
  return (list || []).map(function (e) { return e.synonyms && e.synonyms.length ? e.word + '=' + e.synonyms.join(',') : e.word; }).join('; ');
}

/** 학생 키워드 하나 → 매칭에 쓸 용어들. 목록에 있으면 동의어 포함, 없으면 그 단어 그대로 */
function expandKeywordTerms(keyword, keywordList) {
  var nk = _normKeyword(keyword);
  var entry = (keywordList || []).filter(function (e) { return _normKeyword(e.word) === nk || e.synonyms.some(function (s) { return _normKeyword(s) === nk; }); })[0];
  if (!entry) return [keyword];
  var terms = [entry.word].concat(entry.synonyms);
  if (terms.map(_normKeyword).indexOf(nk) < 0) terms.unshift(keyword);
  return terms;
}

/** 학생 배열에 keywordTerms([{keyword, terms[]}]) 부여 (checkMeal 이 사용). 원본 불변 */
function expandStudentKeywords(students, keywordList) {
  return students.map(function (s) {
    return Object.assign({}, s, { keywordTerms: (s.keywords || []).map(function (k) { return { keyword: k, terms: expandKeywordTerms(k, keywordList) }; }) });
  });
}

/**
 * 시트에서 읽은 학생 객체를 판별용으로 정규화.
 * codes: number[], keywords: string[], active: boolean, grade/classNo/number: number
 */
function normalizeStudent(s) {
  return {
    _row: s._row,
    schoolYear: s.schoolYear === '' || s.schoolYear === undefined ? null : Number(s.schoolYear),
    grade: Number(s.grade),
    classNo: Number(s.classNo),
    name: String(s.name || '').trim(),
    teacherName: String(s.teacherName || '').trim(),
    teacherPhone: String(s.teacherPhone || '').trim(),
    codes: parseAllergyCodes(s.codes),
    keywords: parseKeywords(s.keywords),
    note: String(s.note || ''),
    parentEmail: String(s.parentEmail || '').trim(),
    parentPhone: String(s.parentPhone || '').trim(),
    parentNotify: PARENT_NOTIFY_VALUES.indexOf(s.parentNotify) >= 0 ? s.parentNotify : PARENT_NOTIFY.NONE,
    active: toBool(s.active, true),
  };
}

/** 학생 식별키 '2026|3|2|홍길동' (학년도+학년+반+이름). 동명이인은 같은 키를 가진다 */
function studentKey(s) {
  return [s.schoolYear, s.grade, s.classNo, String(s.name || '').replace(/\s+/g, '')].join('|');
}

/** '3-2 홍길동' */
function formatStudentLabel(s) {
  return s.grade + '-' + s.classNo + ' ' + s.name;
}

/** 학년 → 반 → 이름(가나다) 순 정렬 (원본 불변) */
function sortStudents(students) {
  return students.slice().sort(function (a, b) {
    return (a.grade - b.grade) || (a.classNo - b.classNo) || a.name.localeCompare(b.name, 'ko') || ((a._row || 0) - (b._row || 0));
  });
}

/** 판별 대상 학생: 사용여부 TRUE 이고 학년도가 schoolYear 와 같음(학년도가 비어있으면 포함) */
function filterActiveStudents(students, schoolYear) {
  return students.filter(function (s) {
    if (!s.active) return false;
    if (s.schoolYear === null || s.schoolYear === undefined || isNaN(s.schoolYear)) return true;
    return Number(s.schoolYear) === Number(schoolYear);
  });
}

/**
 * 시트에서 읽은 급식 행을 판별용으로 정규화.
 * codes: number[], needsCheck: 알레르기 표시가 전혀 없고 '확인됨(-)' 도 아님
 */
function normalizeMenu(m) {
  var rawCodes = m.codes;
  var checkedNone = String(rawCodes === undefined || rawCodes === null ? '' : rawCodes).trim() === CODES_CHECKED_NONE;
  var codes = parseAllergyCodes(rawCodes);
  return {
    _row: m._row,
    date: m.date,
    mealType: m.mealType,
    name: String(m.name || '').trim(),
    codes: codes,
    checkedNone: checkedNone,
    needsCheck: codes.length === 0 && !checkedNone,
    source: m.source || SOURCES.NEIS,
    manualEdited: toBool(m.manualEdited, false),
    raw: m.raw || '',
    checkedAt: m.checkedAt === undefined || m.checkedAt === null ? '' : m.checkedAt, // '없음 확인' 처리 시각 (표시용)
  };
}

/**
 * 한 끼니 판별.
 * @param students 정규화된 활성 학생 배열
 * @param menus 정규화된 메뉴 배열 (같은 날짜·끼니)
 * @returns { menus, affected: [{student, items:[{menu, matchedCodes, matchedKeywords}]}], uncheckedMenus: string[] }
 */
function checkMeal(students, menus) {
  var affected = [];
  sortStudents(students).forEach(function (st) {
    var items = [];
    menus.forEach(function (menu) {
      var matchedCodes = menu.codes.filter(function (c) { return st.codes.indexOf(c) >= 0; });
      var normName = _normKeyword(menu.name);
      // expandStudentKeywords 를 거치지 않은 학생은 동의어 없이 키워드 그대로 매칭
      var kwTerms = st.keywordTerms || st.keywords.map(function (k) { return { keyword: k, terms: [k] }; });
      // 키워드는 메뉴명 부분 문자열 매칭 (공백 제거·소문자 비교). 동의어 중 하나라도 포함되면 해당
      var matchedKeywords = kwTerms.filter(function (kt) {
        return kt.terms.some(function (t) { var nt = _normKeyword(t); return nt !== '' && normName.indexOf(nt) >= 0; });
      }).map(function (kt) { return kt.keyword; });
      if (matchedCodes.length || matchedKeywords.length) {
        items.push({ menu: menu, matchedCodes: matchedCodes, matchedKeywords: matchedKeywords });
      }
    });
    if (items.length) affected.push({ student: st, items: items });
  });
  return {
    menus: menus,
    affected: affected,
    uncheckedMenus: menus.filter(function (m) { return m.needsCheck; }).map(function (m) { return m.name; }),
  };
}

/**
 * 기간 판별. 메뉴 배열을 날짜·끼니로 묶어 checkMeal 을 적용.
 * @returns { [date]: { [mealType]: checkMeal 결과 } }  (날짜 오름차순 키)
 */
function checkPeriod(students, menus, mealTypes) {
  var allowed = mealTypes && mealTypes.length ? mealTypes : MEAL_TYPES;
  var grouped = {};
  menus.forEach(function (m) {
    if (allowed.indexOf(m.mealType) < 0) return;
    if (!grouped[m.date]) grouped[m.date] = {};
    if (!grouped[m.date][m.mealType]) grouped[m.date][m.mealType] = [];
    grouped[m.date][m.mealType].push(m);
  });
  var result = {};
  Object.keys(grouped).sort().forEach(function (date) {
    result[date] = {};
    allowed.forEach(function (mt) {
      if (grouped[date][mt]) result[date][mt] = checkMeal(students, grouped[date][mt]);
    });
  });
  return result;
}

/** checkPeriod 결과 → 날짜별 요약 [{date, affectedCount, uncheckedCount, mealTypes}] (달력 뱃지용) */
function summarizePeriod(periodResult) {
  return Object.keys(periodResult).map(function (date) {
    var byType = periodResult[date];
    var studentsSet = {};
    var unchecked = 0;
    var protectedMeal = false;
    Object.keys(byType).forEach(function (mt) {
      byType[mt].affected.forEach(function (a) { studentsSet[studentKey(a.student)] = true; });
      unchecked += byType[mt].uncheckedMenus.length;
      if (byType[mt].menus.some(function (m) { return m.manualEdited; })) protectedMeal = true;
    });
    return {
      date: date,
      affectedCount: Object.keys(studentsSet).length,
      uncheckedCount: unchecked,
      manualProtected: protectedMeal,
      mealTypes: Object.keys(byType),
    };
  });
}

/**
 * 학생 1명으로 돌린 checkPeriod 결과 → 날짜별 평탄화 (학생별 월간 현황용).
 * 해당 항목이 있는 날짜만 반환. 학생을 여럿 넣었다면 모두 섞여 나오므로 반드시 1명으로 호출.
 * @returns [{ date, meals: [{ mealType, items }] }]  (날짜 오름차순, 끼니는 mealTypes 순)
 */
function calcStudentDays(periodResult) {
  var out = [];
  Object.keys(periodResult).sort().forEach(function (date) {
    var byType = periodResult[date];
    var meals = [];
    Object.keys(byType).forEach(function (mt) {
      byType[mt].affected.forEach(function (a) { meals.push({ mealType: mt, items: a.items }); });
    });
    if (meals.length) out.push({ date: date, meals: meals });
  });
  return out;
}

/** 한 항목의 원인 문자열: '돈까스(밀, 돼지고기)' / '키위 요거트(키위)' / '카레(밀, 키위)' */
function formatAffectedItem(item) {
  var reasons = allergenNames(item.matchedCodes).concat(item.matchedKeywords);
  return item.menu.name + '(' + reasons.join(', ') + ')';
}
