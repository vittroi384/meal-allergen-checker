/**
 * 시간 트리거 핸들러. 모두 try/catch 로 감싸고 실패를 알림로그에 남긴다.
 * 실제 작업 함수(run*_)는 Sync.js / Notify.js 에 있다 (3·4단계). 아직 없으면 로그만 남긴다.
 */

/** 모든 트리거 공통 래퍼: 스크립트 락으로 동시 실행을 막고, 미배포 기능·예외를 알림로그에 남긴다 */
function _runGuarded(name, fn) {
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
function triggerDailySync() {
  _runGuarded('triggerDailySync', function () {
    if (!_isNeisConfigured()) return;
    var ym = yearMonthOf(todayStr_());
    runSyncMonths_([ym], { notify: false, notifyOnError: true });
  });
}

/** 매월 1일 04:00 — 이번 달 + 다음 달 */
function triggerMonthlySync() {
  _runGuarded('triggerMonthlySync', function () {
    if (!_isNeisConfigured()) return;
    var ym = yearMonthOf(todayStr_());
    runSyncMonths_([ym, addMonths(ym, 1)], { notify: true });
  });
}

/** 매일 담당자알림시간 — 오늘 요약 1통 */
function triggerStaffDaily() {
  _runGuarded('triggerStaffDaily', function () { runStaffDaily_({}); });
}

/** 매주 월요일 — 주간 요약 */
function triggerStaffWeekly() {
  _runGuarded('triggerStaffWeekly', function () { runStaffWeekly_({}); });
}

/** 매일 학부모알림시간 — 다음 급식일 개별 발송 */
function triggerParentEvening() {
  _runGuarded('triggerParentEvening', function () { runParentNotices_({}); });
}

/** NEIS 인증키와 학교코드가 모두 설정됐는지. 미설정이면 동기화 트리거는 조용히 건너뛴다 */
function _isNeisConfigured() {
  var s = readSettings();
  return hasSecret('NEIS_API_KEY') && String(s['학교코드'] || '').trim() !== '';
}
