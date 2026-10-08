/**
 * 시간 트리거 핸들러. 모두 try/catch 로 감싸고 실패를 알림로그에 남긴다.
 * 실제 작업 함수(run*_)는 Sync.js / Notify.js 에 있다 (3·4단계). 아직 없으면 로그만 남긴다.
 */

/**
 * 트리거 핸들러 첫 줄 가드. 이벤트 객체의 triggerUid 가 이 프로젝트에 등록된 트리거의 ID 와 일치할 때만 true.
 * 트리거 핸들러는 전역 이름이어야 해서 웹앱의 google.script.run 으로도 호출될 수 있는데, 브라우저는 uid 를 알 수 없으므로 거부된다.
 */
function requireTrigger_(e) {
  var uid = e && e.triggerUid ? String(e.triggerUid) : '';
  if (!uid) return false;
  return ScriptApp.getProjectTriggers().some(function (t) { return String(t.getUniqueId()) === uid; });
}

/** 모든 트리거 공통 래퍼: 스크립트 락으로 동시 실행을 막고, 미배포 기능·예외를 알림로그에 남긴다 */
function runGuarded_(name, fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    console.warn(name + ': 다른 실행이 진행 중이라 건너뜀');
    return;
  }
  try {
    if (typeof fn !== 'function') {
      appendLog_({ kind: NOTICE_KINDS.SYSTEM, summary: name + ': 기능 미배포로 건너뜀', ok: false, error: 'not implemented' });
      return;
    }
    fn();
  } catch (e) {
    logError_(name, e);
  } finally {
    lock.releaseLock();
  }
}

/** 매일 03:00 — 이번 달 재동기화 (학교 미설정이면 조용히 건너뜀) */
function triggerDailySync(e) {
  if (!requireTrigger_(e)) return;
  runGuarded_('triggerDailySync', function () {
    if (!isNeisConfigured_()) return;
    var ym = yearMonthOf(todayStr_());
    runSyncMonths_([ym], { notify: false, notifyOnError: true });
  });
}

/** 매월 1일 04:00 — 이번 달 + 다음 달 */
function triggerMonthlySync(e) {
  if (!requireTrigger_(e)) return;
  runGuarded_('triggerMonthlySync', function () {
    if (!isNeisConfigured_()) return;
    var ym = yearMonthOf(todayStr_());
    runSyncMonths_([ym, addMonths(ym, 1)], { notify: true });
  });
}

/** 매일 담당자알림시간 — 오늘 요약 1통 */
function triggerStaffDaily(e) {
  if (!requireTrigger_(e)) return;
  runGuarded_('triggerStaffDaily', function () { runStaffDaily_({}); });
}

/** 매주 월요일 — 주간 요약 */
function triggerStaffWeekly(e) {
  if (!requireTrigger_(e)) return;
  runGuarded_('triggerStaffWeekly', function () { runStaffWeekly_({}); });
}

/** 매일 학부모알림시간 — 다음 급식일 개별 발송 */
function triggerParentEvening(e) {
  if (!requireTrigger_(e)) return;
  runGuarded_('triggerParentEvening', function () { runParentNotices_({}); });
}

/** NEIS 인증키와 학교코드가 모두 설정됐는지. 미설정이면 동기화 트리거는 조용히 건너뛴다 */
function isNeisConfigured_() {
  var s = readSettings_();
  return hasSecret_('NEIS_API_KEY') && String(s['학교코드'] || '').trim() !== '';
}
