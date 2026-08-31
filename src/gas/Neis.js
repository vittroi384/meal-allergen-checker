/**
 * NEIS Open API 호출 (UrlFetchApp). 파싱은 core/neisParser.js.
 */

function neisKey_() {
  var key = getSecret('NEIS_API_KEY');
  if (!key) throw new Error('NEIS 인증키가 설정되지 않았습니다. 웹앱 설정 화면에서 입력하세요 (open.neis.go.kr 에서 발급).');
  return key;
}

/** URL 호출 → JSON. HTTP 오류·비 JSON 응답은 예외. */
function neisFetchJson_(url) {
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  var code = res.getResponseCode();
  var body = res.getContentText('UTF-8');
  if (code !== 200) throw new Error('NEIS 응답 오류 HTTP ' + code + ': ' + body.slice(0, 200));
  try {
    return JSON.parse(body);
  } catch (e) {
    throw new Error('NEIS 응답을 JSON 으로 읽을 수 없습니다: ' + body.slice(0, 200));
  }
}

function schoolParams_(settings) {
  var s = settings || readSettings();
  var atpt = String(s['시도교육청코드'] || '').trim();
  var code = String(s['학교코드'] || '').trim();
  if (!atpt || !code) throw new Error('학교가 설정되지 않았습니다. 웹앱 설정 화면에서 학교를 검색해 선택하세요.');
  return { atptCode: atpt, schoolCode: code };
}

/**
 * 기간·끼니의 급식을 모두 가져온다 (끼니별 호출, 페이지네이션 처리).
 * @returns { ok, noData, error, meals, rows }  rows = flattenMeals 결과 (syncDiff 입력)
 */
function fetchMealsForRange_(start, end, mealTypes, settings) {
  var key = neisKey_();
  var school = schoolParams_(settings);
  var allMeals = [];
  var anyData = false;
  for (var i = 0; i < mealTypes.length; i++) {
    var mealCode = NEIS_MEAL_CODE[mealTypes[i]];
    if (!mealCode) continue;
    var pIndex = 1;
    var fetchedCount = 0;
    while (true) {
      var url = buildMealUrl({ key: key, atptCode: school.atptCode, schoolCode: school.schoolCode, from: start, to: end, mealCode: mealCode, pIndex: pIndex, pSize: 1000 });
      var parsed = parseMealResponse(neisFetchJson_(url));
      if (parsed.noData) break;
      if (!parsed.ok) {
        return { ok: false, noData: false, error: 'NEIS ' + parsed.code + ' ' + parsed.message, meals: [], rows: [] };
      }
      anyData = true;
      allMeals = allMeals.concat(parsed.meals);
      fetchedCount += parsed.meals.length;
      if (fetchedCount >= parsed.total || parsed.meals.length === 0) break;
      pIndex++;
      if (pIndex > 10) break; // 안전장치
    }
  }
  return { ok: true, noData: !anyData, error: '', meals: allMeals, rows: flattenMeals(allMeals) };
}

/** 학교 검색. @returns { ok, error, schools } */
function searchSchools_(name, atptCode) {
  var q = String(name || '').trim();
  if (q.length < 2) return { ok: false, error: '학교명을 2글자 이상 입력하세요', schools: [] };
  var url = buildSchoolSearchUrl({ key: neisKey_(), name: q, atptCode: atptCode || '', pSize: 30 });
  var parsed = parseSchoolResponse(neisFetchJson_(url));
  if (parsed.noData) return { ok: true, error: '', schools: [] };
  if (!parsed.ok) return { ok: false, error: 'NEIS ' + parsed.code + ' ' + parsed.message, schools: [] };
  return { ok: true, error: '', schools: parsed.schools };
}

/** 인증키 유효성 확인: 아무 학교나 1건 조회 */
function testNeisKey_(key) {
  var url = buildSchoolSearchUrl({ key: key, name: '초등학교', pSize: 1 });
  var parsed = parseSchoolResponse(neisFetchJson_(url));
  if (parsed.ok || parsed.noData) return { ok: true };
  return { ok: false, error: 'NEIS ' + parsed.code + ' ' + parsed.message };
}
