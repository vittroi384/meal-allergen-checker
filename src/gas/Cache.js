/**
 * CacheService 기반 읽기 캐시.
 * - 모든 키는 "데이터 버전" 접두어를 갖는다. 학생/급식/설정이 바뀌면 버전을 올려 전부 즉시 무효화.
 * - 값이 100KB 를 넘으면 조각으로 나눠 저장 (급식 데이터가 1년치면 넘을 수 있음).
 */

var CACHE_TTL_SECONDS = 600;          // 10분
var CACHE_VERSION_TTL = 6 * 60 * 60;  // 버전 키 수명 (지나면 자연스럽게 전체 무효화)
var CACHE_CHUNK_CHARS = 30000;        // 한글 3바이트 기준 ~90KB

/** 스크립트 전역 캐시 핸들. */
function cache_() {
  return CacheService.getScriptCache();
}

/** 현재 데이터 버전 문자열. 없으면 지금 시각으로 새로 만든다. */
function dataVersion_() {
  var c = cache_();
  var v = c.get('data_ver');
  if (!v) {
    v = String(Date.now());
    c.put('data_ver', v, CACHE_VERSION_TTL);
  }
  return v;
}

/** 학생/급식/설정 변경 시 호출 → 모든 캐시 즉시 무효화 */
function bumpDataVersion_() {
  cache_().put('data_ver', String(Date.now()), CACHE_VERSION_TTL);
}

/** 버전 접두어를 붙인 실제 캐시 키. 버전이 바뀌면 이전 키들은 자연히 못 찾게 된다. */
function _cacheKey(key) {
  return 'v' + dataVersion_() + ':' + key;
}

/** 캐시 조회. 없거나 읽기 실패면 null (호출자는 시트에서 다시 읽으면 됨). */
function cacheGet_(key) {
  try {
    var c = cache_();
    var k = _cacheKey(key);
    var head = c.get(k);
    if (head === null || head === undefined) return null;
    // 머리값이 '#n' 이면 n개 조각으로 나뉘어 저장된 큰 값 — 조각을 모두 모아 복원
    if (head.charAt(0) !== '#') return JSON.parse(head);
    var n = Number(head.slice(1));
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(k + ':' + i);
    var parts = c.getAll(keys);
    var str = '';
    for (var j = 0; j < n; j++) {
      if (!parts[keys[j]]) return null; // 조각 유실 → 미스 처리
      str += parts[keys[j]];
    }
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

/** 캐시 저장. CacheService 항목당 100KB 제한이 있어 큰 값은 조각으로 나눠 저장. 실패해도 동작에는 지장 없음. */
function cachePut_(key, value) {
  try {
    var c = cache_();
    var k = _cacheKey(key);
    var str = JSON.stringify(value);
    if (str.length <= CACHE_CHUNK_CHARS) {
      c.put(k, str, CACHE_TTL_SECONDS);
      return;
    }
    // 큰 값: 'key:0', 'key:1' ... 조각으로 저장하고 머리 키에는 조각 수('#n')만 기록
    var map = {};
    var n = 0;
    for (var i = 0; i < str.length; i += CACHE_CHUNK_CHARS) {
      map[k + ':' + n] = str.slice(i, i + CACHE_CHUNK_CHARS);
      n++;
    }
    map[k] = '#' + n;
    c.putAll(map, CACHE_TTL_SECONDS);
  } catch (e) {
    console.warn('cachePut_ 실패 ' + key + ': ' + e);
  }
}

/** 캐시에 있으면 반환, 없으면 loader() 실행 후 저장 */
function cached_(key, loader) {
  var v = cacheGet_(key);
  if (v !== null) return v;
  v = loader();
  cachePut_(key, v);
  return v;
}
