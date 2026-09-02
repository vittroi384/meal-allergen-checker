/**
 * 시트 2차원 배열 ↔ 객체 배열 변환. 헤더명 기준이라 열 순서가 바뀌어도 안전.
 */

/** 문자열 셀 정규화: trim, 전각 공백 제거. 숫자/불리언은 그대로. */
function normalizeCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.replace(/　/g, ' ').trim();
  return v;
}

/**
 * values2d[0] 을 헤더로 보고 fieldMap({헤더명: 필드명}) 에 따라 객체 배열로 변환.
 * 반환 객체에는 _row (시트 1-based 행 번호) 가 붙는다.
 * 완전히 빈 행은 건너뛴다.
 */
function tableToObjects(values2d, fieldMap, options) {
  var opts = options || {};
  var headerRowIndex = opts.headerRowIndex || 0;
  if (!values2d || values2d.length <= headerRowIndex) return [];
  var headers = values2d[headerRowIndex].map(function (h) { return String(normalizeCell(h)); });
  var colToField = headers.map(function (h) { return fieldMap[h] || null; });
  var out = [];
  for (var r = headerRowIndex + 1; r < values2d.length; r++) {
    var row = values2d[r];
    var obj = { _row: r + 1 };
    var empty = true;
    for (var c = 0; c < colToField.length; c++) {
      if (!colToField[c]) continue;
      var v = normalizeCell(row[c]);
      if (v !== '' && v !== false) empty = false;
      obj[colToField[c]] = v;
    }
    if (empty) continue;
    out.push(obj);
  }
  return out;
}

/** 객체 배열 → headers 순서의 2차원 배열 (헤더 행 제외). fieldMap 은 {헤더명: 필드명}. */
function objectsToTable(objects, headers, fieldMap) {
  return objects.map(function (o) {
    return headers.map(function (h) {
      var f = fieldMap[h];
      var v = o[f];
      return v === undefined || v === null ? '' : v;
    });
  });
}

/**
 * 헤더 행 감지. 첫 행이 expectedHeaders 중 필수 헤더(requiredHeaders)를 모두 포함하면 true.
 * 엑셀 붙여넣기/업로드에서 헤더 유무를 판단할 때 사용.
 */
function detectHeaderRow(firstRow, requiredHeaders) {
  if (!firstRow) return false;
  var cells = firstRow.map(function (c) { return String(normalizeCell(c)); });
  return requiredHeaders.every(function (h) { return cells.indexOf(h) >= 0; });
}

/** 탭 구분 텍스트(엑셀 복사) → 2차원 배열. CRLF/LF 모두 처리, 끝의 빈 줄 제거. */
function parseTsv(text) {
  var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.map(function (line) { return line.split('\t'); });
}

/** 셀 값을 불리언으로. TRUE/true/예/Y/1/O/체크 → true */
function toBool(v, defaultValue) {
  if (v === true) return true;
  if (v === false) return false;
  var s = String(v === undefined || v === null ? '' : v).trim().toUpperCase();
  if (s === '') return defaultValue === undefined ? false : defaultValue;
  return ['TRUE', 'Y', 'YES', '예', 'O', '1', '사용', '켜짐', 'ON'].indexOf(s) >= 0;
}

/** 시트의 Date 객체 또는 문자열 → 'yyyy-MM-dd'. 실패 시 ''. (Date 는 로컬 시간대 기준으로 읽는다) */
function cellToDateStr(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    var y = v.getFullYear();
    var m = String(v.getMonth() + 1).padStart(2, '0');
    var d = String(v.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }
  var s = String(v === undefined || v === null ? '' : v).trim();
  // '2026-09-01' / '2026.9.1.' / '2026/9/1' 형태
  var m1 = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\.?$/.exec(s);
  if (m1) return m1[1] + '-' + m1[2].padStart(2, '0') + '-' + m1[3].padStart(2, '0');
  // '20260901' 형태 (구분자 없는 8자리)
  var m2 = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m2) return m2[1] + '-' + m2[2] + '-' + m2[3];
  return '';
}

/** 쉼표 구분 문자열 → trim 된 비어있지 않은 항목 배열 */
function splitList(s) {
  return String(s === undefined || s === null ? '' : s)
    // 반각 쉼표 외에 전각 쉼표(，)·가운뎃점(、)·세미콜론(;)도 구분자로 인정
    .split(/[,，、;]/)
    .map(function (x) { return x.trim(); })
    .filter(function (x) { return x !== ''; });
}
