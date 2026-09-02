/**
 * 다른 구글 계정으로 이관: 설정 내보내기/가져오기 (비밀값 제외).
 */
// 시트 메뉴 [급식 알레르기] 에서 다이얼로그(ui/dialogs/migration_*.html)를 띄우고,
// 다이얼로그의 google.script.run 이 dialog* 함수를 호출한다. 학생/급식 데이터는
// 스프레드시트 파일 복사로 옮기므로 여기서는 설정·상태값만 다룬다.

var MIGRATION_VERSION = 1;

/** 이관 JSON 객체 생성. 비밀값은 키 이름만 (설정 여부) 포함. */
function buildMigrationExport_() {
  var settings = readSettings();
  var exported = {};
  SETTING_KEYS.forEach(function (k) { exported[k] = settings[k]; });
  var state = {};
  STATE_KEYS.forEach(function (k) { var v = getState(k); if (v) state[k] = v; });
  var configured = SECRET_KEYS.filter(function (k) { return k.indexOf('APP_PASSWORD') < 0 && hasSecret(k); });
  return {
    app: 'meal-allergen-checker',
    version: MIGRATION_VERSION,
    exportedAt: nowStr_(),
    schoolName: settings['학교명'] || '',
    settings: exported,
    state: state,
    secretsConfigured: configured, // 새 계정에서 다시 입력해야 하는 비밀값 목록 (값 없음)
  };
}

/** 이관 JSON 검증. 반환 { ok, error, data } */
function parseMigrationJson_(text) {
  var data;
  try {
    data = JSON.parse(String(text || ''));
  } catch (e) {
    return { ok: false, error: 'JSON 형식이 아닙니다: ' + e.message };
  }
  if (!data || data.app !== 'meal-allergen-checker') return { ok: false, error: '이 프로그램의 이관 파일이 아닙니다' };
  if (Number(data.version) > MIGRATION_VERSION) return { ok: false, error: '더 새로운 버전의 이관 파일입니다. 프로그램을 먼저 업데이트하세요' };
  if (!data.settings || typeof data.settings !== 'object') return { ok: false, error: 'settings 항목이 없습니다' };
  // 비밀값이 섞여 들어오는 것을 차단
  var leaked = Object.keys(data.settings).concat(Object.keys(data.state || {})).filter(function (k) { return SECRET_KEYS.indexOf(k) >= 0; });
  if (leaked.length) return { ok: false, error: '비밀값 키가 포함되어 있어 가져올 수 없습니다: ' + leaked.join(', ') };
  return { ok: true, data: data };
}

/** 가져오기 실행. 웹앱URL 은 새 배포에서 달라지므로 가져오지 않는다. */
function applyMigrationImport_(data) {
  var settings = {};
  Object.keys(data.settings).forEach(function (k) {
    if (SETTING_KEYS.indexOf(k) >= 0 && k !== '웹앱URL') settings[k] = data.settings[k];
  });
  writeSettings(settings);
  // 상태값도 복원하되 DEPLOYMENT_ID 는 새 계정의 배포 ID 를 유지해야 하므로 제외
  Object.keys(data.state || {}).forEach(function (k) {
    if (STATE_KEYS.indexOf(k) >= 0 && k !== 'DEPLOYMENT_ID') setState(k, data.state[k]);
  });
  // 가져온 알림 시간 설정에 맞춰 트리거를 새로 등록
  setupTriggers_(readSettings());
  var missing = (data.secretsConfigured || []).filter(function (k) { return SECRET_KEYS.indexOf(k) >= 0 && !hasSecret(k); });
  return { imported: Object.keys(settings).length, secretsToEnter: missing };
}

// ---------- 시트 메뉴용 다이얼로그 ----------

/** 시트 메뉴: 이관 JSON 을 만들어 복사용 다이얼로그로 표시. */
function menuExportMigration() {
  var json = JSON.stringify(buildMigrationExport_(), null, 2);
  var t = HtmlService.createTemplateFromFile('ui/dialogs/migration_export');
  t.json = json;
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(640).setHeight(520), '이관용 설정 내보내기 (비밀값 제외)');
}

/** 시트 메뉴: 이관 JSON 붙여넣기 다이얼로그 표시. */
function menuImportMigration() {
  var html = HtmlService.createHtmlOutputFromFile('ui/dialogs/migration_import').setWidth(640).setHeight(520);
  SpreadsheetApp.getUi().showModalDialog(html, '이관용 설정 가져오기');
}

/** 다이얼로그에서 호출 (시트 편집 권한이 있는 사용자만 메뉴를 열 수 있으므로 세션 검사 없음) */
function dialogImportMigration(text) {
  var parsed = parseMigrationJson_(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  var r = applyMigrationImport_(parsed.data);
  return { ok: true, imported: r.imported, secretsToEnter: r.secretsToEnter, schoolName: parsed.data.schoolName || '' };
}

/** 다이얼로그 미리보기용 */
function dialogPreviewMigration(text) {
  var parsed = parseMigrationJson_(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  var d = parsed.data;
  return { ok: true, schoolName: d.schoolName || '', exportedAt: d.exportedAt || '', settingCount: Object.keys(d.settings).length, secretsConfigured: d.secretsConfigured || [] };
}
