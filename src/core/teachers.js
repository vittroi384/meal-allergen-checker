/**
 * 담임 정보: 학생 시트의 "담임이름"·"담임전화번호" 열에서 반별 담임을 유추한다. 순수 함수.
 * 같은 반에 서로 다른 (이름, 전화번호) 조합이 섞이면 가장 많이 적힌 조합을 쓰고 conflict 로 표시한다.
 */

function _teacherCombo(s) {
  var n = String(s.teacherName || '').trim();
  var p = String(s.teacherPhone || '').trim();
  return n || p ? n + '' + p : '';
}

/**
 * @param students 활성·현재 학년도 학생 (teacherName / teacherPhone 필드 포함)
 * @returns { 'grade|classNo': { grade, classNo, name, phone, combos: [{name, phone, count}], conflict } }
 */
function buildTeacherMapFromStudents(students) {
  var counts = {};
  students.forEach(function (s) {
    var combo = _teacherCombo(s);
    if (!combo) return;
    var k = s.grade + '|' + s.classNo;
    counts[k] = counts[k] || {};
    counts[k][combo] = (counts[k][combo] || 0) + 1;
  });
  var map = {};
  Object.keys(counts).forEach(function (k) {
    var combos = Object.keys(counts[k]).map(function (c) {
      var parts = c.split('');
      return { name: parts[0], phone: parts[1], count: counts[k][c] };
    }).sort(function (a, b) { return (b.count - a.count) || a.name.localeCompare(b.name, 'ko') || a.phone.localeCompare(b.phone); });
    var p = k.split('|').map(Number);
    map[k] = { grade: p[0], classNo: p[1], name: combos[0].name, phone: combos[0].phone, combos: combos, conflict: combos.length > 1 };
  });
  return map;
}

/** 학생 배열에 teacher 필드 부여 ({name, phone, conflict} 또는 null). 원본 불변 */
function attachTeachers(students, teacherMap) {
  return students.map(function (s) {
    var t = teacherMap[s.grade + '|' + s.classNo];
    return Object.assign({}, s, { teacher: t ? { name: t.name, phone: t.phone, conflict: t.conflict } : null });
  });
}

/** '담임 김OO 010-1234-5678' / '담임 김OO' / '담임 미등록' */
function formatTeacherShort(teacher) {
  if (!teacher || (!teacher.name && !teacher.phone)) return '담임 미등록';
  return '담임 ' + [teacher.name, teacher.phone].filter(Boolean).join(' ');
}

/** 담임 정보가 섞인 반 목록 [{grade, classNo, combos:[{name, phone, count}]}] */
function calcTeacherConflicts(students) {
  var map = buildTeacherMapFromStudents(students);
  return Object.keys(map).sort().filter(function (k) { return map[k].conflict; })
    .map(function (k) { return { grade: map[k].grade, classNo: map[k].classNo, combos: map[k].combos }; });
}

/** 경고 문구용: [{name, phone}] → '김OO 010-…, 박OO 010-…' */
function formatTeacherCombos(combos) {
  return combos.map(function (c) { return [c.name || '(이름 없음)', c.phone].filter(Boolean).join(' '); }).join(', ');
}
