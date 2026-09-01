/**
 * 웹앱 URL 정규화.
 * Workspace 계정에서 ScriptApp.getService().getUrl() 은 조직 전용 주소
 *   https://script.google.com/a/macros/{도메인}/s/{배포ID}/exec
 *   https://script.google.com/a/{도메인}/macros/s/{배포ID}/exec
 * 를 돌려주는데, 이 주소는 그 조직 계정으로 로그인한 사람만 열 수 있다.
 * 외부 공유용 표준 주소 https://script.google.com/macros/s/{배포ID}/exec 로 바꾼다.
 */

var _WEBAPP_ORG_PATTERNS = [
  /^(https:\/\/script\.google\.com)\/a\/macros\/[^/]+\/(s\/[^/?#]+\/(?:exec|dev))(.*)$/,
  /^(https:\/\/script\.google\.com)\/a\/[^/]+\/macros\/(s\/[^/?#]+\/(?:exec|dev))(.*)$/,
];

/** @returns 표준 형태 URL. 빈 값이면 ''. 조직 주소가 아니면 공백만 정리해 그대로 */
function normalizeWebAppUrl(url) {
  var u = String(url || '').trim();
  if (!u) return '';
  for (var i = 0; i < _WEBAPP_ORG_PATTERNS.length; i++) {
    var m = _WEBAPP_ORG_PATTERNS[i].exec(u);
    if (m) return m[1] + '/macros/' + m[2] + m[3];
  }
  return u;
}

/** 조직 전용(/a/) 형태인지 */
function isOrgWebAppUrl(url) {
  var u = String(url || '').trim();
  return _WEBAPP_ORG_PATTERNS.some(function (re) { return re.test(u); });
}
