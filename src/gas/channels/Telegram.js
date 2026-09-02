/**
 * 텔레그램 봇 채널 (무료). 담당자용. sendMessage API, 4096자 제한이라 분할 전송.
 */
// 텔레그램 메시지 최대 4096자 — 여유를 두고 4000자에서 분할
var _TG_MAX = 4000;

var telegramChannel_ = {
  id: 'telegram',
  name: '텔레그램',
  isEnabled: function (settings) {
    return settingBool_(settings, '채널_텔레그램') && hasSecret('TELEGRAM_BOT_TOKEN');
  },
  /** 비활성 사유 (설정 화면 안내용). 활성 상태면 '' */
  disabledReason: function (settings) {
    if (!settingBool_(settings, '채널_텔레그램')) return '설정에서 꺼져 있음';
    if (!hasSecret('TELEGRAM_BOT_TOKEN')) return '봇 토큰 미입력';
    return '';
  },
  /** to: chat id */
  send: function (msg) {
    try {
      var token = getSecret('TELEGRAM_BOT_TOKEN');
      var text = (msg.subject ? msg.subject + '\n\n' : '') + (msg.text || '');
      var chunks = [];
      // 긴 알림은 여러 통으로 분할 — 가급적 줄바꿈 경계에서 자르고, 적당한 위치가 없으면 그냥 4000자에서 자른다
      while (text.length > _TG_MAX) {
        var cut = text.lastIndexOf('\n', _TG_MAX);
        if (cut < _TG_MAX / 2) cut = _TG_MAX;
        chunks.push(text.slice(0, cut));
        text = text.slice(cut);
      }
      chunks.push(text);
      for (var i = 0; i < chunks.length; i++) {
        var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify({ chat_id: String(msg.to), text: chunks[i], disable_web_page_preview: true }),
          muteHttpExceptions: true,
        });
        var body = res.getContentText('UTF-8');
        var json;
        try { json = JSON.parse(body); } catch (e) { json = null; }
        if (!json || !json.ok) return { ok: false, error: '텔레그램 ' + res.getResponseCode() + ' ' + (json && json.description ? json.description : body.slice(0, 200)) };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  },
};

/** 봇에게 말을 건 사용자의 chat id 목록 (설정 화면 "chat id 찾기" 용) */
function telegramRecentChats_() {
  var token = getSecret('TELEGRAM_BOT_TOKEN');
  if (!token) return { ok: false, error: '봇 토큰 미입력', chats: [] };
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getUpdates', { muteHttpExceptions: true });
  var json;
  try { json = JSON.parse(res.getContentText('UTF-8')); } catch (e) { return { ok: false, error: '응답 해석 실패', chats: [] }; }
  if (!json.ok) return { ok: false, error: json.description || '오류', chats: [] };
  var seen = {};
  var chats = [];
  (json.result || []).forEach(function (u) {
    var m = u.message || u.channel_post;
    if (!m || !m.chat) return;
    var id = String(m.chat.id);
    if (seen[id]) return;
    seen[id] = true;
    chats.push({ id: id, name: m.chat.title || [m.chat.first_name, m.chat.last_name].filter(Boolean).join(' ') || m.chat.username || id });
  });
  return { ok: true, error: '', chats: chats };
}
