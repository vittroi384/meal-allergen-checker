/**
 * 설정(설정 시트) / 비밀값(Script Properties) / 상태값(Script Properties) 접근.
 * 비밀값은 여기서만 읽고 쓴다. 로그·UI 로는 "설정됨/미설정" 만 내보낸다.
 */

function props_() {
  return PropertiesService.getScriptProperties();
}

// ---------- 비밀값 ----------

function getSecret(key) {
  if (SECRET_KEYS.indexOf(key) < 0) throw new Error('알 수 없는 비밀값 키: ' + key);
  return props_().getProperty(key) || '';
}

function setSecret(key, value) {
  if (SECRET_KEYS.indexOf(key) < 0) throw new Error('알 수 없는 비밀값 키: ' + key);
  var v = value === undefined || value === null ? '' : String(value).trim();
  if (v) props_().setProperty(key, v);
  else props_().deleteProperty(key);
}

function hasSecret(key) {
  return getSecret(key) !== '';
}

/** UI 용: 어떤 비밀값이 설정되어 있는지 (값은 절대 포함하지 않음) */
function getSecretStatus() {
  var out = {};
  SECRET_KEYS.forEach(function (k) { out[k] = hasSecret(k); });
  return out;
}

// ---------- 상태값 (비밀 아님) ----------

function getState(key) {
  return props_().getProperty(key) || '';
}

function setState(key, value) {
  var v = value === undefined || value === null ? '' : String(value);
  if (v) props_().setProperty(key, v);
  else props_().deleteProperty(key);
}

// ---------- 웹앱 URL ----------

/**
 * 외부 공유용 웹앱 URL (항상 https://script.google.com/macros/s/{id}/exec 형태).
 * Workspace 계정은 getUrl() 이 조직 전용 /a/macros/{도메인}/ 주소를 주므로 저장·표시 모두 정규화한다.
 */
function webAppUrl_(settings) {
  // 1순위: 실제 웹 요청(doGet)에서 확인된 배포 ID — 가장 확실한 값
  var id = getState('DEPLOYMENT_ID');
  if (id) return buildWebAppUrl(id);
  // 2순위: 기록된 URL (setup/메뉴에서 getUrl() 로 얻은 값일 수 있음)
  return normalizeWebAppUrl(getState('WEBAPP_URL') || (settings || readSettings())['웹앱URL'] || '');
}

/**
 * 현재 웹앱 URL 을 상태·설정 시트에 기록하고 돌려준다.
 * @param fromWebRequest doGet 안에서 호출됐는가. 이때의 getUrl() 은 지금 접속된 배포의 URL 이라 신뢰할 수 있으므로
 *   배포 ID(DEPLOYMENT_ID) 를 뽑아 저장한다. 시트 메뉴·setup 같은 비웹 컨텍스트의 getUrl() 은 HEAD(/dev) 배포를
 *   가리킬 수 있어 ID 를 갱신하지 않고 폴백으로만 쓴다.
 */
function recordWebAppUrl_(fromWebRequest) {
  var seen = normalizeWebAppUrl(ScriptApp.getService().getUrl());
  if (fromWebRequest) {
    var id = extractDeploymentId(seen);
    if (id && getState('DEPLOYMENT_ID') !== id) setState('DEPLOYMENT_ID', id);
  }
  var url = webAppUrl_() || seen;
  if (!url) return '';
  if (getState('WEBAPP_URL') !== url) {
    setState('WEBAPP_URL', url);
    writeSettings({ '웹앱URL': url });
  }
  return url;
}

// ---------- 설정 시트 ----------

/** 설정 시트 → { 키: 값(문자열 또는 불리언) }. 없는 키는 기본값. 캐시됨(설정 변경 시 무효화). */
function readSettings() {
  return cached_('settings', function () {
    var defaults = {};
    SETTING_DEFS.forEach(function (d) { defaults[d[0]] = d[1]; });
    var sheet = getSpreadsheet_().getSheetByName(SHEETS.SETTINGS);
    if (!sheet) return defaults;
    var values = sheet.getDataRange().getValues();
    var out = Object.assign({}, defaults);
    for (var r = 1; r < values.length; r++) {
      var key = String(values[r][0] || '').trim();
      if (!key) continue;
      var v = values[r][1];
      out[key] = typeof v === 'boolean' ? v : String(v === null || v === undefined ? '' : v).trim();
    }
    return out;
  });
}

/**
 * 설정 일부 저장. { 키: 값 }. 시트에 없는 키는 행을 추가한다.
 * 불리언 키는 체크박스 셀이므로 boolean 으로 기록.
 */
function writeSettings(partial) {
  var sheet = ensureSheet_(SHEETS.SETTINGS, HEADERS.SETTINGS);
  var values = sheet.getDataRange().getValues();
  var rowByKey = {};
  for (var r = 1; r < values.length; r++) {
    var k = String(values[r][0] || '').trim();
    if (k) rowByKey[k] = r + 1;
  }
  var descByKey = {};
  SETTING_DEFS.forEach(function (d) { descByKey[d[0]] = d[2]; });

  // 기존 키는 값 열을 한 번에 갱신, 새 키는 하단에 한 번에 추가
  var colValues = values.length > 1 ? sheet.getRange(2, 2, values.length - 1, 1).getValues() : [];
  var changed = false;
  var toAppend = [];
  Object.keys(partial).forEach(function (key) {
    if (SETTING_KEYS.indexOf(key) < 0) return; // 정의되지 않은 키는 무시
    var v = partial[key];
    if (SETTING_BOOL_KEYS.indexOf(key) >= 0) v = toBool(v, false);
    else v = v === undefined || v === null ? '' : String(v).trim();
    if (rowByKey[key]) {
      colValues[rowByKey[key] - 2][0] = v;
      changed = true;
    } else {
      toAppend.push([key, v, descByKey[key] || '']);
    }
  });
  if (changed && colValues.length) sheet.getRange(2, 2, colValues.length, 1).setValues(colValues);
  if (toAppend.length) {
    var start = sheet.getLastRow() + 1;
    sheet.getRange(start, 1, toAppend.length, 3).setValues(toAppend);
    toAppend.forEach(function (row, i) {
      if (SETTING_BOOL_KEYS.indexOf(row[0]) >= 0) {
        sheet.getRange(start + i, 2).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
      }
    });
  }
  bumpDataVersion_();
}

function settingBool_(settings, key) {
  return toBool(settings[key], false);
}

function settingList_(settings, key) {
  return splitList(settings[key]);
}

/** 관리할 끼니 (유효한 값만, 비어 있으면 중식) */
function managedMealTypes_(settings) {
  var list = settingList_(settings, '관리할끼니').filter(function (t) { return MEAL_TYPES.indexOf(t) >= 0; });
  return list.length ? list : ['중식'];
}

/** 오늘 날짜 'yyyy-MM-dd' (Asia/Seoul 고정) */
function todayStr_() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
}

/** 현재 시각 'yyyy-MM-dd HH:mm:ss' (Asia/Seoul) */
function nowStr_() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
}

/** 현재 학년도 (설정 override 반영) */
function currentSchoolYear_(settings) {
  return calcSchoolYear(todayStr_(), (settings || readSettings())['학년도override']);
}
