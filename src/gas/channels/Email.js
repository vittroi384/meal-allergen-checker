/**
 * 이메일 채널 (MailApp, 무료). 채널 인터페이스:
 *   { id, name, isEnabled(settings), send({to, subject, text, html}) → {ok, error} }
 */
var EMAIL_SENDER_NAME = '급식 알레르기 알림';

var emailChannel_ = {
  id: 'email',
  name: '이메일',
  isEnabled: function (settings) {
    return settingBool_(settings, '채널_이메일');
  },
  /** to: 이메일 문자열 (쉼표로 여러 명 가능 = 1통) */
  send: function (msg) {
    try {
      if (MailApp.getRemainingDailyQuota() <= 0) return { ok: false, error: '오늘 이메일 발송 한도를 모두 사용했습니다' };
      MailApp.sendEmail({
        to: msg.to,
        subject: msg.subject || '(제목 없음)',
        body: msg.text || '',
        htmlBody: msg.html || undefined,
        name: EMAIL_SENDER_NAME,
        noReply: true,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  },
};
