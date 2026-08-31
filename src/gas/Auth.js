/**
 * 접속 비밀번호(SHA-256 + salt, Script Properties) 와 세션 토큰(CacheService, 6시간).
 * SESSION_GEN 상태값을 올리면 모든 세션이 즉시 무효화된다 (비밀번호 재설정 시).
 */

var _PW_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; // 혼동 문자 제외
var _LOGIN_FAIL_LIMIT = 10;
var _LOGIN_LOCK_SECONDS = 15 * 60;

function _sha256Hex(str) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function _hashPassword(password, salt) {
  return _sha256Hex(salt + ':' + String(password));
}

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

function isPasswordSet_() {
  return hasSecret('APP_PASSWORD_HASH') && hasSecret('APP_PASSWORD_SALT');
}

function verifyPassword_(password) {
  if (!isPasswordSet_()) return false;
  var expected = getSecret('APP_PASSWORD_HASH');
  var actual = _hashPassword(password, getSecret('APP_PASSWORD_SALT'));
  if (expected.length !== actual.length) return false;
  var diff = 0;
  for (var i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return diff === 0;
}

function _sessionGen() {
  return getState('SESSION_GEN') || '1';
}

function invalidateAllSessions_() {
  setState('SESSION_GEN', String(Number(_sessionGen()) + 1));
}

function createSession_() {
  var token = Utilities.getUuid() + Utilities.getUuid().slice(0, 8);
  CacheService.getScriptCache().put('sess:' + token, _sessionGen(), SESSION_TTL_SECONDS);
  return token;
}

/** 모든 api* 함수 첫 줄에서 호출. 유효하면 TTL 을 연장한다. */
function requireSession(token) {
  var cache = CacheService.getScriptCache();
  var key = 'sess:' + String(token || '');
  var gen = token ? cache.get(key) : null;
  if (!gen || gen !== _sessionGen()) {
    throw new Error('AUTH_REQUIRED');
  }
  cache.put(key, gen, SESSION_TTL_SECONDS);
  return true;
}

function destroySession_(token) {
  if (token) CacheService.getScriptCache().remove('sess:' + token);
}

// ---------- 로그인 API (세션 불필요) ----------

function _loginFailKey() { return 'login_fail'; }

function apiLogin(password) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get(_loginFailKey()) || 0);
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

function apiLogout(token) {
  destroySession_(token);
  return { ok: true };
}

/** 세션 유효성 확인 (앱 시작 시) */
function apiCheckSession(token) {
  try {
    requireSession(token);
    return { ok: true };
  } catch (e) {
    return { ok: false };
  }
}

function apiChangePassword(token, currentPassword, newPassword) {
  requireSession(token);
  if (!verifyPassword_(currentPassword)) return { ok: false, error: '현재 비밀번호가 올바르지 않습니다.' };
  setPassword_(newPassword);
  return { ok: true, token: createSession_() };
}
