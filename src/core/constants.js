/**
 * 전역 상수. 시트 이름·헤더·설정 키·알레르기 코드표의 단일 출처.
 * 순수 상수만 두고 다른 파일의 함수를 호출하지 않는다.
 */

/** 학교급식 표준 알레르기 유발식품 19종 (NEIS 번호와 동일) */
var ALLERGENS = Object.freeze({
  1: '난류',
  2: '우유',
  3: '메밀',
  4: '땅콩',
  5: '대두',
  6: '밀',
  7: '고등어',
  8: '게',
  9: '새우',
  10: '돼지고기',
  11: '복숭아',
  12: '토마토',
  13: '아황산류',
  14: '호두',
  15: '닭고기',
  16: '쇠고기',
  17: '오징어',
  18: '조개류',
  19: '잣',
});

var ALLERGEN_MIN = 1;
var ALLERGEN_MAX = 19;

/** 알레르기코드 셀에 이 값이 있으면 "알레르기 없음으로 사람이 확인함" (확인 필요 배지 해제) */
var CODES_CHECKED_NONE = '-';

var SHEETS = Object.freeze({
  STUDENTS: '학생',
  MEALS: '급식',
  LOGS: '알림로그',
  SETTINGS: '설정',
  TEMPLATE: '학생_업로드템플릿',
});

var HEADERS = Object.freeze({
  STUDENTS: Object.freeze([
    '학년도', '학년', '반', '이름', '담임이름', '담임전화번호', '알레르기코드', '기타알레르기', '비고',
    '학부모이메일', '학부모연락처', '학부모알림', '사용여부',
  ]),
  MEALS: Object.freeze(['날짜', '식사구분', '메뉴명', '알레르기코드', '출처', '수동수정여부', '원본문자열']),
  LOGS: Object.freeze(['발송시각', '채널', '종류', '수신자', '대상일', '내용요약', '성공여부', '오류', '중복키']),
  SETTINGS: Object.freeze(['키', '값', '설명']),
});

/** 시트 헤더 → 코드 내부 필드명 매핑 (시트 열 순서와 무관하게 헤더명으로 찾는다) */
var FIELD_MAP = Object.freeze({
  STUDENTS: Object.freeze({
    '학년도': 'schoolYear', '학년': 'grade', '반': 'classNo', '이름': 'name', '담임이름': 'teacherName', '담임전화번호': 'teacherPhone',
    '알레르기코드': 'codes', '기타알레르기': 'keywords', '비고': 'note',
    '학부모이메일': 'parentEmail', '학부모연락처': 'parentPhone', '학부모알림': 'parentNotify', '사용여부': 'active',
  }),
  MEALS: Object.freeze({
    '날짜': 'date', '식사구분': 'mealType', '메뉴명': 'name', '알레르기코드': 'codes',
    '출처': 'source', '수동수정여부': 'manualEdited', '원본문자열': 'raw',
  }),
  LOGS: Object.freeze({
    '발송시각': 'sentAt', '채널': 'channel', '종류': 'kind', '수신자': 'recipient', '대상일': 'targetDate',
    '내용요약': 'summary', '성공여부': 'ok', '오류': 'error', '중복키': 'dedupeKey',
  }),
});

var MEAL_TYPES = Object.freeze(['조식', '중식', '석식']);
/** NEIS MMEAL_SC_CODE */
var NEIS_MEAL_CODE = Object.freeze({ '조식': '1', '중식': '2', '석식': '3' });
var NEIS_MEAL_NAME = Object.freeze({ '1': '조식', '2': '중식', '3': '석식' });

var SOURCES = Object.freeze({ NEIS: 'NEIS', MANUAL: '수동' });

var PARENT_NOTIFY = Object.freeze({ NONE: '없음', EMAIL: '이메일', SMS: '문자' });
var PARENT_NOTIFY_VALUES = Object.freeze(['없음', '이메일', '문자']);

var CHANNELS = Object.freeze({ EMAIL: '이메일', SMS: '문자', TELEGRAM: '텔레그램', SYSTEM: '시스템' });

var NOTICE_KINDS = Object.freeze({
  STAFF_DAILY: '담당자일일',
  STAFF_WEEKLY: '담당자주간',
  SYNC_RESULT: '동기화결과',
  PARENT: '학부모',
  TEST: '테스트',
  SYSTEM: '시스템',
});

/** 설정 시트 키. [키, 기본값, 설명] */
var SETTING_DEFS = Object.freeze([
  ['학교명', '', '설정 화면에서 학교 검색으로 채워집니다'],
  ['시도교육청코드', '', '예: B10 (서울)'],
  ['학교코드', '', 'NEIS 표준 학교코드'],
  ['학년도override', '', '비우면 자동 계산 (3월 1일 기준)'],
  ['관리할끼니', '중식', '조식,중식,석식 중 쉼표로 구분'],
  ['기타알레르기목록', '', '기타 알레르기 키워드 목록. 형식: 키위=골드키위,그린키위; 망고; 복숭아=천도복숭아 (세미콜론 구분, =뒤는 동의어). 목록에 없는 키워드는 그 단어 그대로 매칭'],
  ['담당자알림시간', '07:30', 'HH:mm. 실제 발송은 ±15분 오차가 있습니다'],
  ['학부모알림시간', '18:00', '전날 HH:mm. 실제 발송은 ±15분 오차가 있습니다'],
  ['담당자이메일', '', '쉼표로 구분해 여러 명 가능'],
  ['담당자텔레그램chatid', '', '쉼표로 구분해 여러 명 가능'],
  ['채널_이메일', 'TRUE', ''],
  ['채널_문자', 'FALSE', '문자 API 키가 있어야 켜집니다'],
  ['채널_텔레그램', 'FALSE', '텔레그램 봇 토큰이 있어야 켜집니다'],
  ['문자제공자', '알리고', '알리고 (솔라피는 추후 지원)'],
  ['문자발신번호', '', '문자 제공사에 사전 등록된 발신번호'],
  ['학부모알림사용', 'FALSE', '전체 on/off. 켜면 학부모알림이 "없음"이 아닌 학생에게 전날 발송'],
  ['담당자일일알림', 'TRUE', ''],
  ['담당자주간알림', 'TRUE', '매주 월요일'],
  ['주말공휴일알림', 'FALSE', '급식 데이터가 없는 날에도 담당자 알림을 보낼지'],
  ['웹앱URL', '', '배포 후 자동 기록 (알림 메일의 링크에 사용)'],
]);

var SETTING_KEYS = Object.freeze(SETTING_DEFS.map(function (d) { return d[0]; }));

/** Script Properties 에만 저장하는 비밀값 키 (시트·로그·이관 JSON 에 절대 포함 금지) */
var SECRET_KEYS = Object.freeze([
  'NEIS_API_KEY',
  'SMS_API_KEY',
  'SMS_USER_ID',
  'SMS_API_SECRET',
  'TELEGRAM_BOT_TOKEN',
  'APP_PASSWORD_HASH',
  'APP_PASSWORD_SALT',
]);

/** 비밀이 아닌 Script Properties 키 (이관 JSON 에 포함) */
var STATE_KEYS = Object.freeze([
  'LAST_SYNC_AT',
  'LAST_SYNC_RESULT',
  'DEPLOYMENT_ID',
  'AUTH_MODE',
]);

var SESSION_TTL_SECONDS = 6 * 60 * 60; // CacheService 상한

var KOREAN_DAYS = Object.freeze(['일', '월', '화', '수', '목', '금', '토']);

/** 설정 시트에서 체크박스로 표시할 불리언 키 */
var SETTING_BOOL_KEYS = Object.freeze([
  '채널_이메일', '채널_문자', '채널_텔레그램', '학부모알림사용', '담당자일일알림', '담당자주간알림', '주말공휴일알림',
]);

/** 시간 트리거 핸들러 이름 (setup 이 등록/정리하는 대상) */
var TRIGGER_HANDLERS = Object.freeze([
  'triggerDailySync', 'triggerMonthlySync', 'triggerStaffDaily', 'triggerStaffWeekly', 'triggerParentEvening',
]);
