/**
 * NEIS 교육정보 개방포털 응답 파싱. 순수 함수.
 *
 * 실제 응답 형태 (test/fixtures/neis-meal-sample.json, 2026-06 서울대치초 기준):
 *   정상:     {"mealServiceDietInfo":[{"head":[{"list_total_count":21},{"RESULT":{"CODE":"INFO-000",...}}]},{"row":[...]}]}
 *   데이터없음/오류: {"RESULT":{"CODE":"INFO-200","MESSAGE":"해당하는 데이터가 없습니다."}}
 * DDISH_NM: "현미찹쌀밥 <br/>소고기감자국 (5.6.16)<br/>참외 <br/>우유 (2)"
 *   - 요리 구분자 <br/>, 알레르기 번호는 요리명 뒤 괄호 안에 점 구분. 옛 데이터는 끝에 점 "(1.5.6.)".
 *   - 번호가 없는 요리는 괄호 없이 공백만 남음.
 */

var NEIS_BASE_URL = 'https://open.neis.go.kr/hub/';

/** NEIS 결과 코드 → 사용자용 설명 (응답 MESSAGE 가 있으면 그것을 우선 사용) */
var NEIS_RESULT_CODES = Object.freeze({
  'INFO-000': '정상',
  'INFO-100': '인증키가 유효하지 않습니다',
  'INFO-200': '해당하는 데이터가 없습니다',
  'INFO-300': '관리자에 의해 인증키 사용이 제한되었습니다',
  'ERROR-290': '인증키가 유효하지 않습니다',
  'ERROR-300': '필수 값이 누락되었습니다',
  'ERROR-310': '존재하지 않는 서비스입니다',
  'ERROR-333': '요청 위치 값의 타입이 잘못되었습니다',
  'ERROR-336': '데이터 요청은 한 번에 최대 1,000건입니다',
  'ERROR-337': '일별 트래픽 제한을 초과했습니다',
  'ERROR-500': 'NEIS 서버 오류',
  'ERROR-600': 'NEIS 데이터베이스 연결 오류',
  'ERROR-601': 'NEIS SQL 오류',
});

/** 쿼리스트링 조립 (UTF-8 인코딩). 값이 빈 파라미터는 생략. */
function buildNeisUrl(service, params) {
  var q = Object.keys(params)
    .filter(function (k) { return params[k] !== undefined && params[k] !== null && String(params[k]) !== ''; })
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k])); })
    .join('&');
  return NEIS_BASE_URL + service + '?' + q;
}

/**
 * 급식식단정보 요청 URL.
 * @param p { key, atptCode, schoolCode, from:'yyyy-MM-dd', to:'yyyy-MM-dd', mealCode?:'1'|'2'|'3', pIndex?, pSize? }
 */
function buildMealUrl(p) {
  return buildNeisUrl('mealServiceDietInfo', {
    KEY: p.key,
    Type: 'json',
    pIndex: p.pIndex || 1,
    pSize: p.pSize || 1000,
    ATPT_OFCDC_SC_CODE: p.atptCode,
    SD_SCHUL_CODE: p.schoolCode,
    MMEAL_SC_CODE: p.mealCode,
    MLSV_FROM_YMD: toYmd(p.from),
    MLSV_TO_YMD: toYmd(p.to),
  });
}

/** 학교기본정보 요청 URL */
function buildSchoolSearchUrl(p) {
  return buildNeisUrl('schoolInfo', {
    KEY: p.key,
    Type: 'json',
    pIndex: 1,
    pSize: p.pSize || 30,
    SCHUL_NM: p.name,
    ATPT_OFCDC_SC_CODE: p.atptCode,
  });
}

/**
 * 요리 문자열 하나 → { name, codes:number[], raw }
 *   '소고기감자국 (5.6.16)' → name '소고기감자국', codes [5,6,16]
 *   '돈까스 (1.5.6.)' / '돈까스(1,5,6)' / '돈까스 1.5.6.' / '돈까스 (1)(5)' 모두 처리
 *   '참외 ' → name '참외', codes []
 */
function parseDishItem(raw) {
  var s = String(raw || '').replace(/\s+/g, ' ').trim();
  var codes = [];
  var changed = true;
  // 끝에 붙은 괄호 그룹 반복 제거: (1.5.6.), （1,5,6）, [1.5]
  while (changed && s) {
    changed = false;
    var m = /^(.*?)\s*[(\[（]\s*([\d][\d\s.,、]*)\s*[)\]）]\s*$/.exec(s);
    if (m) {
      codes = codes.concat(parseAllergyCodes(m[2]));
      s = m[1].trim();
      changed = true;
    }
  }
  // 괄호 없이 뒤에 붙은 "5.9.13." 형태 (점으로 구분된 번호 나열만 인정)
  var tail = /^(.*?\S)\s*((?:\d{1,2}\.)+\d{0,2})\s*$/.exec(s);
  if (tail && /[^\d.]$/.test(tail[1])) {
    codes = codes.concat(parseAllergyCodes(tail[2]));
    s = tail[1].trim();
  }
  // 앞뒤 특수문자 정리 (*, ♥ 등 강조 기호)
  s = s.replace(/^[\s*♥♡★☆#]+|[\s*♥♡★☆#]+$/g, '').trim();
  return { name: s, codes: parseAllergyCodes(codes), raw: String(raw || '').trim() };
}

/** DDISH_NM 전체 → 요리 배열. 구분자는 <br/>, <br>, <br />, 줄바꿈. 빈 항목 제거. */
function parseDishString(ddishNm) {
  return String(ddishNm || '')
    .split(/<br\s*\/?>|\r?\n/i)
    .map(function (x) { return x.trim(); })
    .filter(function (x) { return x !== ''; })
    .map(parseDishItem)
    .filter(function (d) { return d.name !== ''; });
}

/**
 * NEIS 응답(JSON 파싱된 객체) 공통 해석.
 * @returns { ok, code, message, rows: object[], total }
 *   ok = INFO-000. 데이터 없음(INFO-200)은 ok=false, noData=true, rows=[] 로 구분.
 */
function parseNeisEnvelope(json, serviceName) {
  var result = { ok: false, noData: false, code: '', message: '', rows: [], total: 0 };
  if (!json || typeof json !== 'object') {
    result.code = 'PARSE';
    result.message = '응답을 해석할 수 없습니다';
    return result;
  }
  if (json.RESULT) {
    result.code = json.RESULT.CODE || '';
    result.message = json.RESULT.MESSAGE || NEIS_RESULT_CODES[result.code] || '';
    result.noData = result.code === 'INFO-200';
    return result;
  }
  var arr = json[serviceName];
  if (!Array.isArray(arr)) {
    result.code = 'PARSE';
    result.message = '알 수 없는 응답 형식';
    return result;
  }
  var head = null, rows = [];
  arr.forEach(function (part) {
    if (part.head) head = part.head;
    if (part.row) rows = part.row;
  });
  if (head) {
    head.forEach(function (h) {
      if (h.list_total_count !== undefined) result.total = Number(h.list_total_count);
      if (h.RESULT) {
        result.code = h.RESULT.CODE || '';
        result.message = h.RESULT.MESSAGE || NEIS_RESULT_CODES[result.code] || '';
      }
    });
  }
  result.rows = rows;
  result.ok = result.code === 'INFO-000';
  return result;
}

/**
 * 급식 응답 → 끼니 배열.
 * @returns { ok, noData, code, message, total, meals: [{ date, mealType, mealCode, dishes:[{name,codes,raw}], calories, origin, nutrition, raw }] }
 */
function parseMealResponse(json) {
  var env = parseNeisEnvelope(json, 'mealServiceDietInfo');
  var meals = env.rows.map(function (r) {
    var code = String(r.MMEAL_SC_CODE || '');
    return {
      date: fromYmd(r.MLSV_YMD),
      mealType: NEIS_MEAL_NAME[code] || String(r.MMEAL_SC_NM || ''),
      mealCode: code,
      dishes: parseDishString(r.DDISH_NM),
      calories: String(r.CAL_INFO || ''),
      origin: String(r.ORPLC_INFO || ''),
      nutrition: String(r.NTR_INFO || ''),
      raw: String(r.DDISH_NM || ''),
    };
  });
  return { ok: env.ok, noData: env.noData, code: env.code, message: env.message, total: env.total, meals: meals };
}

/** parseMealResponse 의 meals → 급식 시트 행 형태 [{date, mealType, name, codes, raw}] (syncDiff 입력) */
function flattenMeals(meals) {
  var out = [];
  meals.forEach(function (m) {
    m.dishes.forEach(function (d) {
      out.push({ date: m.date, mealType: m.mealType, name: d.name, codes: d.codes, raw: d.raw });
    });
  });
  return out;
}

/**
 * 학교 검색 응답 → 학교 배열.
 * @returns { ok, noData, code, message, schools: [{ atptCode, atptName, schoolCode, name, kind, address }] }
 */
function parseSchoolResponse(json) {
  var env = parseNeisEnvelope(json, 'schoolInfo');
  var schools = env.rows.map(function (r) {
    return {
      atptCode: String(r.ATPT_OFCDC_SC_CODE || ''),
      atptName: String(r.ATPT_OFCDC_SC_NM || ''),
      schoolCode: String(r.SD_SCHUL_CODE || ''),
      name: String(r.SCHUL_NM || ''),
      kind: String(r.SCHUL_KND_SC_NM || ''),
      address: String(r.ORG_RDNMA || ''),
    };
  });
  return { ok: env.ok, noData: env.noData, code: env.code, message: env.message, schools: schools };
}
