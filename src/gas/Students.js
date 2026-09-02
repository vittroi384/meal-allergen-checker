/**
 * 학생 병합 계획 실행 (템플릿/붙여넣기/xlsx 공통).
 */
// 계획 계산은 core/studentMerge.js(calcStudentMergePlan), 여기서는 계산된 계획을 시트에 쓰기만 한다.
// 호출: 시트 메뉴 menuApplyTemplate, 웹앱 학생 업로드 API.

/** calcStudentMergePlan 결과를 시트에 반영. 오류 행이 있으면 예외. */
function applyStudentMergePlan_(plan) {
  if (!plan.ok) throw new Error('오류가 있는 계획은 반영할 수 없습니다 (오류 ' + plan.summary.error + '건)');
  var updated = 0;
  plan.rows.filter(function (r) { return r.status === '수정'; }).forEach(function (r) {
    updateStudentRow_(r.targetRow, r.student);
    updated++;
  });
  var adds = plan.rows.filter(function (r) { return r.status === '추가'; }).map(function (r) { return r.student; });
  var added = appendStudents_(adds);
  return { added: added, updated: updated, unchanged: plan.summary.unchanged };
}
