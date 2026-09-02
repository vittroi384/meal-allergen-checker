/**
 * xlsx ↔ Google 시트 변환 (Drive 고급 서비스 v3). 임시 파일은 finally 에서 삭제.
 * 다운로드 종류별 내용 구성은 아래 build*Export_ 함수.
 */

var XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
var GSHEET_MIME = 'application/vnd.google-apps.spreadsheet';
var XLSX_MAX_BYTES = 5 * 1024 * 1024;

/** base64 xlsx → 첫 시트 2차원 배열 */
function xlsxBase64ToValues_(base64, filename) {
  var bytes = Utilities.base64Decode(String(base64 || '').replace(/^data:[^;]+;base64,/, ''));
  if (bytes.length > XLSX_MAX_BYTES) throw new Error('파일이 5MB 를 넘습니다');
  var blob = Utilities.newBlob(bytes, XLSX_MIME, filename || 'upload.xlsx');
  // Apps Script 에는 xlsx 파서가 없으므로 Drive 에 올리면서 Google 시트로 변환시킨 뒤 값을 읽는다.
  // 임시 파일은 finally 에서 반드시 삭제 (실패해도 경고 로그만 남기고 계속).
  var file = Drive.Files.create({ name: 'tmp_import_' + Date.now(), mimeType: GSHEET_MIME }, blob, { fields: 'id' });
  try {
    var ss = SpreadsheetApp.openById(file.id);
    var sheet = ss.getSheets()[0];
    if (sheet.getLastRow() === 0) return [];
    return sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  } finally {
    try { Drive.Files.remove(file.id); } catch (e) { console.warn('임시 파일 삭제 실패: ' + e); }
  }
}

/**
 * 시트 사양 배열 → xlsx base64.
 * @param sheets [{ name, headers: string[], rows: any[][], widths?: number[] }]
 */
function buildXlsxBase64_(sheets) {
  // 반대 방향 변환: 임시 Google 시트를 만들어 내용을 채우고 Drive export API 로 xlsx 를 받는다
  var ss = SpreadsheetApp.create('tmp_export_' + Date.now());
  var id = ss.getId();
  try {
    sheets.forEach(function (spec, i) {
      var sh = i === 0 ? ss.getSheets()[0] : ss.insertSheet();
      sh.setName(spec.name.slice(0, 90));
      var width = spec.headers.length;
      var data = [spec.headers].concat((spec.rows || []).map(function (r) {
        var row = r.slice(0, width);
        while (row.length < width) row.push('');
        return row.map(function (c) { return c === null || c === undefined ? '' : c; });
      }));
      if (width > 0) {
        // 전체를 텍스트 서식(@)으로: 날짜·전화번호·코드가 엑셀에서 숫자/날짜로 변형되는 것을 방지
        sh.getRange(1, 1, data.length, width).setNumberFormat('@').setValues(data);
        sh.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#dbeafe');
        sh.setFrozenRows(1);
        (spec.widths || []).forEach(function (w, c) { if (w) sh.setColumnWidth(c + 1, w); });
      }
    });
    SpreadsheetApp.flush();
    var url = 'https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=' + encodeURIComponent(XLSX_MIME);
    var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      throw new Error('xlsx 변환 실패 (HTTP ' + res.getResponseCode() + '). ' + res.getContentText().slice(0, 200));
    }
    return Utilities.base64Encode(res.getContent());
  } finally {
    try { Drive.Files.remove(id); } catch (e) { console.warn('임시 파일 삭제 실패: ' + e); }
  }
}

/** 파일명에 쓸 수 없는 문자·공백을 _ 로 치환 */
function _safeFilename(s) {
  return String(s || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
}

/**
 * 다운로드 API.
 * kind: 'students' | 'template' | 'day' | 'month' | 'class' | 'meals'
 * params: { date, ym, start, end, grade, classNo, activeOnly }
 * @returns { filename, base64, mime }
 */
function apiDownloadXlsx(token, kind, params) {
  requireSession(token);
  var p = params || {};
  var settings = readSettings();
  var school = settings['학교명'] || '학교';
  var spec;
  var label;
  switch (kind) {
    case 'students': spec = buildStudentsExport_(p, settings); label = '학생명단_' + school; break;
    case 'template': spec = buildTemplateExport_(); label = '학생_업로드양식'; break;
    case 'day':
      if (!isValidDateStr(p.date)) throw new Error('날짜 오류');
      spec = buildResultExport_(p.date, p.date, settings); label = '알레르기해당_' + school + '_' + p.date; break;
    case 'month': {
      if (!/^\d{4}-\d{2}$/.test(p.ym || '')) throw new Error('월 오류');
      var r = monthRange(p.ym);
      spec = buildResultExport_(r.start, r.end, settings); label = '알레르기해당_' + school + '_' + p.ym; break;
    }
    case 'class':
      spec = buildClassPrintExport_(p, settings); label = '반별목록_' + school + '_' + p.start + '_' + p.end; break;
    case 'meals':
      if (!/^\d{4}-\d{2}$/.test(p.ym || '')) throw new Error('월 오류');
      spec = buildMealsExport_(p.ym); label = '급식_' + school + '_' + p.ym; break;
    default: throw new Error('알 수 없는 다운로드 종류');
  }
  return { filename: _safeFilename(label) + '.xlsx', base64: buildXlsxBase64_(spec), mime: XLSX_MIME };
}

// ---------- 내보내기 내용 ----------

// 여러 내보내기에 공통으로 첨부하는 알레르기 코드표 시트 사양
var _CODE_TABLE_SHEET = {
  name: '알레르기코드표',
  headers: ['코드', '명칭'],
  rows: Object.keys(ALLERGENS).map(function (k) { return [Number(k), ALLERGENS[k]]; }),
  widths: [60, 160],
};

/** 학생 명단 내보내기 (필터: 사용중만/학년/반). 시트 헤더와 동일한 열 구성 */
function buildStudentsExport_(p, settings) {
  var list = sortStudents(readStudents_());
  if (p.activeOnly) list = filterActiveStudents(list, currentSchoolYear_(settings));
  if (p.grade) list = list.filter(function (s) { return s.grade === Number(p.grade); });
  if (p.classNo) list = list.filter(function (s) { return s.classNo === Number(p.classNo); });
  var rows = list.map(function (s) {
    var o = studentToSheetObject(s);
    return HEADERS.STUDENTS.map(function (h) {
      var v = o[FIELD_MAP.STUDENTS[h]];
      return typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v;
    });
  });
  return [{ name: '학생', headers: HEADERS.STUDENTS.slice(), rows: rows, widths: _STUDENT_WIDTHS }, _CODE_TABLE_SHEET];
}

// 학생 시트 열 너비(px). HEADERS.STUDENTS 순서와 1:1 대응
var _STUDENT_WIDTHS = [70, 55, 55, 100, 100, 140, 140, 170, 280, 230, 140, 95, 80];

/** 빈 학생 업로드 양식: 빈 학생 시트 + 코드표 + 작성안내 */
function buildTemplateExport_() {
  return [
    { name: '학생', headers: HEADERS.STUDENTS.slice(), rows: [], widths: _STUDENT_WIDTHS },
    _CODE_TABLE_SHEET,
    {
      name: '작성안내', headers: ['항목', '설명'], widths: [140, 600],
      rows: [
        ['필수 열', '학년, 반, 이름 (학생 식별키 = 학년+반+이름. 같은 반 동명이인은 미리보기에서 경고)'],
        ['학년도', '비우면 업로드 시점의 현재 학년도(3월 1일 기준)로 채워집니다'],
        ['담임이름 / 담임전화번호', '같은 반은 같은 값이어야 하며 다르면 미리보기에서 경고합니다. 전화번호는 휴대폰·유선 모두 가능'],
        ['알레르기코드', '1~19 번호를 쉼표로 구분 (예: 1,2,6). 코드표 시트 참고'],
        ['기타알레르기', '19종 외 키워드를 쉼표로 구분 (예: 키위,망고). 메뉴명에 포함되면 해당으로 판별'],
        ['학부모알림', '없음 / 이메일 / 문자 중 하나. 비우면 없음'],
        ['학부모연락처', '휴대폰 번호 (하이픈 유무 무관)'],
        ['사용여부', 'TRUE/FALSE. 비우면 TRUE'],
        ['병합 규칙', '학년·반·이름이 같은 기존 학생은 수정, 아니면 추가. 삭제는 하지 않습니다'],
        ['열 순서', '헤더명으로 인식하므로 열 순서를 바꿔도 됩니다. 헤더 행은 지우지 마세요'],
      ],
    },
  ];
}

/** 기간 판별 결과 내보내기: "해당학생" 시트(누가·왜) + "메뉴" 시트(급식별 코드) */
function buildResultExport_(start, end, settings) {
  var mealTypes = managedMealTypes_(settings);
  var students = readActiveStudents_(settings);
  var meals = readMealsInRange_(start, end, mealTypes);
  var period = checkPeriod(students, meals, mealTypes);
  var rows = [];
  var menuRows = [];
  Object.keys(period).forEach(function (date) {
    Object.keys(period[date]).forEach(function (t) {
      var r = period[date][t];
      r.menus.forEach(function (m) { menuRows.push([date, t, m.name, formatAllergyCodes(m.codes), allergenNames(m.codes).join(', '), m.needsCheck ? '확인 필요' : (m.checkedNone ? '없음 확인' : '')]); });
      r.affected.forEach(function (a) {
        var s = a.student;
        rows.push([date, formatKoreanDate(date), t, s.grade, s.classNo, s.name, formatTeacherShort(s.teacher).replace(/^담임 /, ''),
          a.items.map(formatAffectedItem).join(', '), formatAllergyCodes(s.codes), s.keywords.join(','), s.parentNotify]);
      });
    });
  });
  return [
    { name: '해당학생', headers: ['날짜', '요일', '끼니', '학년', '반', '이름', '담임', '문제 메뉴(원인)', '학생 알레르기코드', '기타알레르기', '학부모알림'],
      rows: rows, widths: [100, 70, 60, 50, 50, 90, 200, 400, 120, 120, 90] },
    { name: '메뉴', headers: ['날짜', '끼니', '메뉴명', '알레르기코드', '알레르기명', '비고'], rows: menuRows, widths: [100, 60, 240, 110, 260, 90] },
  ];
}

/** 반별 목록 내보내기: 학급마다 시트 하나. 해당 학생이 없으면 안내 시트 1장 */
function buildClassPrintExport_(p, settings) {
  if (!isValidDateStr(p.start) || !isValidDateStr(p.end)) throw new Error('기간 오류');
  var data = apiPrintDataInternal_(p, settings);
  var sheets = data.classes.map(function (c) {
    return {
      name: c.grade + '-' + c.classNo,
      headers: ['날짜', '요일', '끼니', '이름', '못 먹는 메뉴(원인)', '담임'],
      rows: c.rows.map(function (r) { return [r.date, r.label, r.mealType, r.name, r.text, c.teacherLabel]; }),
      widths: [100, 70, 60, 90, 420, 220],
    };
  });
  if (!sheets.length) sheets.push({ name: '해당없음', headers: ['안내'], rows: [['해당 기간에 해당 학생이 없습니다']] });
  return sheets;
}

/** apiPrintData 와 동일 로직 (세션 검사 없이 내부 호출용) */
function apiPrintDataInternal_(p, settings) {
  var mealTypes = managedMealTypes_(settings);
  var students = readActiveStudents_(settings);
  var period = checkPeriod(students, readMealsInRange_(p.start, p.end, mealTypes), mealTypes);
  var byClass = {};
  Object.keys(period).forEach(function (date) {
    Object.keys(period[date]).forEach(function (t) {
      period[date][t].affected.forEach(function (a) {
        var st = a.student;
        if (p.grade && Number(p.grade) !== st.grade) return;
        if (p.classNo && Number(p.classNo) !== st.classNo) return;
        var key = st.grade + '-' + st.classNo;
        if (!byClass[key]) byClass[key] = { grade: st.grade, classNo: st.classNo, key: key, teacherLabel: formatTeacherShort(st.teacher), rows: [] };
        byClass[key].rows.push({ date: date, label: formatKoreanDate(date), mealType: t, name: st.name, text: a.items.map(formatAffectedItem).join(', ') });
      });
    });
  });
  var classes = Object.keys(byClass).map(function (k) { return byClass[k]; }).sort(function (a, b) { return (a.grade - b.grade) || (a.classNo - b.classNo); });
  classes.forEach(function (c) { c.rows.sort(function (a, b) { return a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'ko'); }); });
  return { classes: classes };
}

/** 한 달 급식 원본 내보내기 (급식 시트와 동일한 열 구성 + 코드표) */
function buildMealsExport_(ym) {
  var range = monthRange(ym);
  var rows = readMealsInRange_(range.start, range.end, MEAL_TYPES).map(function (m) {
    return [m.date, m.mealType, m.name, m.checkedNone ? CODES_CHECKED_NONE : formatAllergyCodes(m.codes), m.source, m.manualEdited ? 'TRUE' : 'FALSE', m.raw, m.checkedAt || ''];
  });
  return [{ name: '급식', headers: HEADERS.MEALS.slice(), rows: rows, widths: [110, 85, 240, 140, 75, 110, 300, 130] }, _CODE_TABLE_SHEET];
}
