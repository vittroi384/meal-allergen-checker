/**
 * 시트 서식: 열 너비, 헤더 스타일·틀고정·필터, 숫자/텍스트 서식, 줄바꿈, 줄무늬.
 * setup() 과 메뉴 "서식 다시 적용" 이 같은 함수를 호출한다. 여러 번 실행해도 안전.
 */

var HEADER_BG = '#dbeafe';
var HEADER_FG = '#1e3a8a';
var HEADER_HEIGHT = 30;
var DEFAULT_COL_WIDTH = 110;

/** 헤더명 → 열 너비(px). 헤더와 일반 내용이 잘리지 않도록 넉넉하게. */
var COLUMN_WIDTHS = Object.freeze({
  // 학생 / 템플릿
  '학년도': 70, '학년': 55, '반': 55, '번호': 60, '이름': 100, '알레르기코드': 140, '기타알레르기': 170, '비고': 280,
  '학부모이메일': 230, '학부모연락처': 140, '학부모알림': 95, '사용여부': 80,
  // 급식
  '날짜': 110, '식사구분': 85, '메뉴명': 240, '출처': 75, '수동수정여부': 110, '원본문자열': 300,
  // 알림로그
  '발송시각': 160, '채널': 85, '종류': 105, '수신자': 220, '대상일': 105, '내용요약': 460, '성공여부': 85, '오류': 340, '중복키': 300,
  // 설정
  '키': 190, '값': 260, '설명': 480,
});

/** 텍스트(@) 서식으로 고정할 열 — 날짜/시각/번호가 자동 변환되지 않도록 */
var TEXT_FORMAT_HEADERS = Object.freeze(['날짜', '대상일', '발송시각', '알레르기코드', '학부모연락처', '중복키', '값']);

/** 줄바꿈(WRAP) 할 긴 텍스트 열. 나머지 긴 텍스트는 CLIP + 넓은 너비 */
var WRAP_HEADERS = Object.freeze(['비고', '설명', '기타알레르기']);
var CLIP_HEADERS = Object.freeze(['내용요약', '오류', '원본문자열', '중복키', '메뉴명', '수신자', '학부모이메일']);

/** 가운데 정렬할 짧은 열 */
var CENTER_HEADERS = Object.freeze(['학년도', '학년', '반', '번호', '학부모알림', '사용여부', '날짜', '식사구분', '출처', '수동수정여부', '채널', '종류', '대상일', '성공여부']);

/** 필터를 걸지 않을 시트 */
var NO_FILTER_SHEETS = Object.freeze([SHEETS.SETTINGS]);

var HEADER_PROTECTION_DESC = '헤더 행은 수정하지 마세요';

/** 모든 시트에 서식 적용. 반환: 처리한 시트 수 */
function applyAllFormatting_() {
  var ss = getSpreadsheet_();
  var names = [SHEETS.STUDENTS, SHEETS.MEALS, SHEETS.SETTINGS, SHEETS.LOGS, SHEETS.TEMPLATE];
  var n = 0;
  names.forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) return;
    applySheetFormatting_(sheet);
    n++;
  });
  return n;
}

function applySheetFormatting_(sheet) {
  var lastCol = Math.max(1, sheet.getLastColumn());
  var maxRows = sheet.getMaxRows();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); });
  var isSettings = sheet.getName() === SHEETS.SETTINGS;

  // 헤더: 굵게 + 배경 + 세로 가운데 + 줄바꿈 + 틀고정 + 높이
  var header = sheet.getRange(1, 1, 1, lastCol);
  header.setFontWeight('bold').setFontColor(HEADER_FG).setBackground(HEADER_BG)
    .setVerticalAlignment('middle').setHorizontalAlignment('center').setWrap(true);
  sheet.setRowHeight(1, HEADER_HEIGHT);
  sheet.setFrozenRows(1);

  // 헤더 보호(경고만) — 중복 생성 방지
  sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) {
    if (p.getDescription() === HEADER_PROTECTION_DESC) p.remove();
  });
  header.protect().setWarningOnly(true).setDescription(HEADER_PROTECTION_DESC);

  // 열별 너비 / 서식 / 정렬 / 줄바꿈
  headers.forEach(function (h, i) {
    var col = i + 1;
    var width = COLUMN_WIDTHS[h];
    if (!width) {
      try { sheet.autoResizeColumn(col); } catch (e) { /* ignore */ }
      width = Math.max(sheet.getColumnWidth(col) + 16, 90);
    }
    sheet.setColumnWidth(col, width);
    if (maxRows < 2) return;
    var body = sheet.getRange(2, col, maxRows - 1, 1);
    body.setVerticalAlignment('middle');
    if (TEXT_FORMAT_HEADERS.indexOf(h) >= 0 && !(isSettings && h === '값')) body.setNumberFormat('@');
    if (WRAP_HEADERS.indexOf(h) >= 0) body.setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
    else if (CLIP_HEADERS.indexOf(h) >= 0) body.setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    else body.setWrapStrategy(SpreadsheetApp.WrapStrategy.OVERFLOW);
    if (CENTER_HEADERS.indexOf(h) >= 0) body.setHorizontalAlignment('center');
    else body.setHorizontalAlignment('left');
  });

  // 설정 시트: 키 열 굵게, 값 열은 체크박스 행을 제외하고 텍스트 서식 (초기 설정에서 처리)
  if (isSettings) {
    if (maxRows > 1) sheet.getRange(2, 1, maxRows - 1, 1).setFontWeight('bold');
    sheet.getRange(1, 1, 1, lastCol).setHorizontalAlignment('left');
  }

  // 필터 (헤더 기준, 기존 필터 교체)
  var existing = sheet.getFilter();
  if (existing) existing.remove();
  if (NO_FILTER_SHEETS.indexOf(sheet.getName()) < 0) {
    sheet.getRange(1, 1, maxRows, lastCol).createFilter();
  }

  // 줄무늬 (기존 것 제거 후 재적용)
  sheet.getBandings().forEach(function (b) { b.remove(); });
  if (maxRows > 1 && !isSettings) {
    var banding = sheet.getRange(2, 1, maxRows - 1, lastCol).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
    banding.setFirstRowColor('#ffffff').setSecondRowColor('#f8fafc');
  }

  // 데이터 행 높이 통일, 기본 글꼴 크기
  if (maxRows > 1) {
    sheet.setRowHeights(2, maxRows - 1, 24);
    sheet.getRange(2, 1, maxRows - 1, lastCol).setFontSize(10);
  }
  sheet.setHiddenGridlines(false);
}

/** 메뉴: 서식 다시 적용 */
function menuReapplyFormatting() {
  var n = applyAllFormatting_();
  _alert('서식 적용 완료', n + '개 시트에 열 너비·헤더·필터·서식을 다시 적용했습니다.');
}
