/**
 * 접속 비밀번호(SHA-256 + salt, Script Properties) 와 세션 토큰(CacheService, 6시간).
 * SESSION_GEN 상태값을 올리면 모든 세션이 즉시 무효화된다 (비밀번호 재설정 시).
 */

var _PW_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; // 혼동 문자 제외
var _LOGIN_FAIL_LIMIT = 10;
var _LOGIN_LOCK_SECONDS = 15 * 60;

/** 문자열의 SHA-256 해시를 16진수 문자열로 반환. */
function _sha256Hex(str) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

/** salt 를 섞어 비밀번호를 해시 — 원문 비밀번호는 어디에도 저장하지 않는다. */
function _hashPassword(password, salt) {
  return _sha256Hex(salt + ':' + String(password));
}

/** 초기 설정용 임시 비밀번호 생성 (기본 10자, 혼동 문자 제외). UUID 와 난수를 섞어 예측을 어렵게 한다. */
function generatePassword_(length) {
  var out = '';
  var uuid = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  for (var i = 0; i < (length || 10); i++) {
    var n = parseInt(uuid.substr(i * 2, 2), 16) ^ Math.floor(Math.random() * 256);
    out += _PW_CHARS[n % _PW_CHARS.length];
  }
  return out;
}

/** 비밀번호 저장 (기존 세션 전부 무효화) */
function setPassword_(password) {
  var pw = String(password || '');
  if (pw.length < 6) throw new Error('비밀번호는 6자 이상이어야 합니다');
  var salt = Utilities.getUuid();
  setSecret('APP_PASSWORD_SALT', salt);
  setSecret('APP_PASSWORD_HASH', _hashPassword(pw, salt));
  invalidateAllSessions_();
}

/** 접속 비밀번호가 설정돼 있는지 (해시와 salt 둘 다 있어야 함). */
function isPasswordSet_() {
  return hasSecret('APP_PASSWORD_HASH') && hasSecret('APP_PASSWORD_SALT');
}

/** 입력한 비밀번호가 저장된 해시와 일치하는지 검사. */
function verifyPassword_(password) {
  if (!isPasswordSet_()) return false;
  var expected = getSecret('APP_PASSWORD_HASH');
  var actual = _hashPassword(password, getSecret('APP_PASSWORD_SALT'));
  if (expected.length !== actual.length) return false;
  // 문자 단위 XOR 누적으로 항상 전체 길이를 비교 — 응답 시간 차이로 정답을 추측하는 타이밍 공격 방지
  var diff = 0;
  for (var i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return diff === 0;
}

/** 현재 세션 세대 번호. 토큰에 저장된 세대와 다르면 그 세션은 무효. */
function _sessionGen() {
  return getState('SESSION_GEN') || '1';
}

/** 세대 번호를 올려 발급된 모든 세션을 즉시 무효화 (비밀번호 변경/재설정 시). */
function invalidateAllSessions_() {
  setState('SESSION_GEN', String(Number(_sessionGen()) + 1));
}

/** 새 세션 토큰 발급 — CacheService 에 세대 번호와 함께 저장 (수명 SESSION_TTL_SECONDS). */
function createSession_() {
  var token = Utilities.getUuid() + Utilities.getUuid().slice(0, 8);
  CacheService.getScriptCache().put('sess:' + token, _sessionGen(), SESSION_TTL_SECONDS);
  return token;
}

// ---------- 인증 모드 (시트 메뉴에서만 변경) ----------
// off      : 비밀번호 없이 누구나 접속 (기본)
// settings : 설정 탭(설정 API)만 비밀번호
// on       : 전체 로그인 필요

var AUTH_MODES = ['off', 'settings', 'on'];

/** 현재 인증 모드. 저장값이 이상하면 안전하게 'off' 로 취급. */
function authMode_() {
  var m = getState('AUTH_MODE');
  return AUTH_MODES.indexOf(m) >= 0 ? m : 'off';
}

/** 인증 모드 변경 (시트 메뉴에서만 호출). */
function setAuthMode_(mode) {
  if (AUTH_MODES.indexOf(mode) < 0) throw new Error('알 수 없는 인증 모드: ' + mode);
  setState('AUTH_MODE', mode);
}

/** 세션 토큰이 유효한지 (모드와 무관하게 순수 검사). 유효하면 TTL 연장 */
function _hasValidSession(token) {
  var cache = CacheService.getScriptCache();
  var key = 'sess:' + String(token || '');
  var gen = token ? cache.get(key) : null;
  if (!gen || gen !== _sessionGen()) return false;
  cache.put(key, gen, SESSION_TTL_SECONDS);
  return true;
}

/**
 * 모든 api* 함수 첫 줄에서 호출.
 * @param level 'admin' 이면 설정 계열 API (settings 모드에서도 잠김). 생략 시 일반.
 */
function requireSession(token, level) {
  var mode = authMode_();
  if (mode === 'off') return true;
  if (mode === 'settings' && level !== 'admin') return true;
  if (!_hasValidSession(token)) throw new Error('AUTH_REQUIRED');
  return true;
}

/** 클라이언트 시작 시 (인증 불필요) */
function apiAuthInfo() {
  return { mode: authMode_(), passwordSet: isPasswordSet_() };
}

/** 세션 토큰 1개 제거 (로그아웃). */
function destroySession_(token) {
  if (token) CacheService.getScriptCache().remove('sess:' + token);
}

// ---------- 로그인 API (세션 불필요) ----------

/** 로그인 실패 횟수를 저장하는 캐시 키. */
function _loginFailKey() { return 'login_fail'; }

/** 로그인(웹앱, 유일하게 세션 없이 호출 가능). 성공 시 { ok, token }, 실패 시 { ok:false, error }. */
function apiLogin(password) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get(_loginFailKey()) || 0);
  // 15분 안에 10회 실패하면 잠금 — 무차별 대입 차단
  if (fails >= _LOGIN_FAIL_LIMIT) {
    return { ok: false, error: '로그인 실패가 너무 많습니다. 15분 후 다시 시도하세요.' };
  }
  if (!isPasswordSet_()) {
    return { ok: false, error: '비밀번호가 아직 설정되지 않았습니다. 시트 메뉴 [급식 알레르기] → 초기 설정을 실행하세요.' };
  }
  if (!verifyPassword_(password)) {
    cache.put(_loginFailKey(), String(fails + 1), _LOGIN_LOCK_SECONDS);
    Utilities.sleep(500 * Math.min(fails + 1, 4)); // 무차별 대입 지연
    return { ok: false, error: '비밀번호가 올바르지 않습니다.' };
  }
  cache.remove(_loginFailKey());
  return { ok: true, token: createSession_() };
}

/** 로그아웃(웹앱). 항상 { ok: true }. */
function apiLogout(token) {
  destroySession_(token);
  return { ok: true };
}

/** 세션 토큰 유효성 (모드와 무관). 설정 탭 잠금 해제 여부 판단에 사용 */
function apiCheckSession(token) {
  return { ok: _hasValidSession(token), mode: authMode_() };
}

/** 비밀번호 변경(웹앱, admin). 성공 시 모든 세션이 무효화되므로 새 토큰을 만들어 돌려준다. */
function apiChangePassword(token, currentPassword, newPassword) {
  requireSession(token, 'admin');
  if (!verifyPassword_(currentPassword)) return { ok: false, error: '현재 비밀번호가 올바르지 않습니다.' };
  setPassword_(newPassword);
  return { ok: true, token: createSession_() };
}
