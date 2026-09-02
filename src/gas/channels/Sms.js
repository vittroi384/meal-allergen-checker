/**
 * 문자 채널. 1차: 알리고(smartsms.aligo.in). 제공자별 구현은 _smsProviders 에 추가한다 (솔라피 추후).
 * 알리고 API: POST https://apis.aligo.in/send/  (key, user_id, sender, receiver, msg, msg_type, title)
 *   응답 JSON: { result_code: "1", message: "success", msg_id, success_cnt, error_cnt, msg_type }
 *   result_code 가 "1" 이면 성공, 음수면 오류.
 */

// 제공자 이름(설정 '문자제공자' 값) → { requiredSecrets: 필요한 비밀값 키, send: 발송 구현 }
var _smsProviders = {
  '알리고': {
    requiredSecrets: ['SMS_API_KEY', 'SMS_USER_ID'],
    send: function (settings, to, text) {
      // 단문(SMS)은 90바이트(한글 약 45자)까지 — 넘으면 장문(LMS)으로 전환하고 제목을 붙인다
      var isLms = calcSmsBytes(text) > 90;
      var payload = {
        key: getSecret('SMS_API_KEY'),
        user_id: getSecret('SMS_USER_ID'),
        sender: String(settings['문자발신번호'] || '').replace(/\D/g, ''),
        receiver: String(to).replace(/\D/g, ''),
        msg: text,
        msg_type: isLms ? 'LMS' : 'SMS',
      };
      if (isLms) payload.title = '급식 알레르기 안내';
      var res = UrlFetchApp.fetch('https://apis.aligo.in/send/', { method: 'post', payload: payload, muteHttpExceptions: true });
      var body = res.getContentText('UTF-8');
      if (res.getResponseCode() !== 200) return { ok: false, error: '알리고 HTTP ' + res.getResponseCode() + ' ' + body.slice(0, 200) };
      var json;
      try { json = JSON.parse(body); } catch (e) { return { ok: false, error: '알리고 응답 해석 실패: ' + body.slice(0, 200) }; }
      if (String(json.result_code) === '1') return { ok: true };
      return { ok: false, error: '알리고 ' + json.result_code + ' ' + (json.message || '') };
    },
  },
  // '솔라피': { requiredSecrets: ['SMS_API_KEY', 'SMS_API_SECRET'], send: function (settings, to, text) { ... HMAC 인증 ... } },
};

/** 설정된 문자 제공자 구현을 찾는다 (기본 알리고). 미지원 이름이면 null */
function _smsProvider(settings) {
  return _smsProviders[String(settings['문자제공자'] || '알리고').trim()] || null;
}

var smsChannel_ = {
  id: 'sms',
  name: '문자',
  isEnabled: function (settings) {
    if (!settingBool_(settings, '채널_문자')) return false;
    var p = _smsProvider(settings);
    if (!p) return false;
    if (!String(settings['문자발신번호'] || '').replace(/\D/g, '')) return false;
    return p.requiredSecrets.every(function (k) { return hasSecret(k); });
  },
  /** 비활성 사유 (설정 화면 안내용) */
  disabledReason: function (settings) {
    if (!settingBool_(settings, '채널_문자')) return '설정에서 꺼져 있음';
    var p = _smsProvider(settings);
    if (!p) return '지원하지 않는 문자 제공자: ' + settings['문자제공자'];
    if (!String(settings['문자발신번호'] || '').replace(/\D/g, '')) return '발신번호 없음';
    var missing = p.requiredSecrets.filter(function (k) { return !hasSecret(k); });
    return missing.length ? '미입력: ' + missing.join(', ') : '';
  },
  /** to: 수신 휴대폰 번호. msg.settings 는 반복 발송 시 재조회를 아끼려 호출측에서 넘길 수 있음 */
  send: function (msg) {
    try {
      var settings = msg.settings || readSettings();
      var p = _smsProvider(settings);
      if (!p) return { ok: false, error: '문자 제공자 미설정' };
      return p.send(settings, msg.to, msg.text);
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  },
};
