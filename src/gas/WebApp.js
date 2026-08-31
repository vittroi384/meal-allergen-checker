/**
 * 웹앱 진입점. (5단계에서 SPA 셸로 교체 — 지금은 배포 확인용 최소 페이지)
 */

function doGet(e) {
  try {
    var url = ScriptApp.getService().getUrl();
    if (url && getState('WEBAPP_URL') !== url) {
      setState('WEBAPP_URL', url);
      writeSettings({ '웹앱URL': url });
    }
  } catch (err) { /* 무시 */ }

  var ready = isPasswordSet_();
  var html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>급식 알레르기 판별</title>' +
    '<style>body{font-family:-apple-system,"Malgun Gothic",sans-serif;background:#f9fafb;color:#111827;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}' +
    '.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px 32px;max-width:440px;box-shadow:0 1px 3px rgba(0,0,0,.06)}h1{font-size:20px;margin:0 0 12px}p{line-height:1.6;margin:0 0 8px;font-size:14px}.ok{color:#059669}.warn{color:#b45309}</style></head><body>' +
    '<div class="card"><h1>급식 알레르기 판별 시스템</h1>' +
    (ready
      ? '<p class="ok">✔ 웹앱 배포가 정상입니다.</p><p>화면(UI)은 다음 단계에서 배포됩니다. 이 URL 은 그대로 유지됩니다.</p>'
      : '<p class="warn">아직 초기 설정이 실행되지 않았습니다.</p><p>스프레드시트에서 메뉴 <b>[급식 알레르기] → 초기 설정</b>을 먼저 실행하세요.</p>') +
    '</div></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('급식 알레르기 판별')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}
