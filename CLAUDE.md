# CLAUDE.md — 프로젝트 규칙

급식 알레르기 판별 시스템. 요구사항의 단일 출처는 `SPEC.md` — 기능을 바꾸면 SPEC 부터 고친다.

## 스택
- Google Apps Script (V8) + Google Sheets + HtmlService. 로컬은 `clasp` 로 동기화.
- Node 24 (로컬 테스트 전용). 런타임 npm 의존성 **없음** — Apps Script 에 번들러가 없으므로.
- 시간대 `Asia/Seoul`. 날짜 문자열은 항상 `yyyy-MM-dd`, NEIS 호출 시에만 `yyyyMMdd`.

## 디렉터리
```
src/            clasp 가 push 하는 루트 (rootDir). 여기 있는 .js/.html 만 배포됨
  core/         순수 로직. Apps Script 전역 객체 사용 금지. Node 에서 그대로 import 가능
  gas/          Apps Script 의존 코드 (Sheets, Properties, UrlFetch, Mail, Triggers)
  ui/           HtmlService 템플릿 (.html) — 화면별 파일 + 공통 css/js include
test/           node:test 기반 테스트. `npm test`
```

## 코드 규칙
- **순수 로직은 `src/core/` 에.** Apps Script 는 모든 파일이 하나의 전역 스코프이므로 `require`/`export` 없이
  함수명으로 바로 호출한다. Node 테스트는 `test/helpers/loadCore.js` 가 core 파일을 이어붙여 하나의 함수 스코프로
  평가해 같은 모델을 재현한다 — `const core = loadCore(); core.parseDishString(...)`.
  - 최상위에는 `function` 선언과 `var` 상수만 둔다 (`const`/`let` 최상위 선언은 다른 파일에서 프로퍼티로 못 읽음).
  - 파일 최상위 코드에서 다른 파일의 함수를 호출하지 않는다 (로드 순서 의존 금지). 함수 본문 안에서는 자유.
  - 내부 전용 헬퍼는 `_` 접두어. 공개 함수는 `parse*`, `check*`, `format*`, `validate*`, `calc*` 접두어.
- `src/gas/` 의 파일은 얇게. 시트 읽기/쓰기 → `core` 호출 → 결과 쓰기 패턴.
- 시트 헤더·시트 이름·설정 키는 `src/core/constants.js` 에 상수로만 정의. 문자열 하드코딩 금지.
- 비밀값은 `PropertiesService.getScriptProperties()` 만. 시트·코드·로그에 절대 기록하지 않는다.
  로그·UI 에는 "설정됨/미설정" 만 표시.
- 웹앱 서버 함수(`google.script.run` 대상)는 모두 `api*` 접두어를 쓰고, 첫 인자로 세션 토큰을 받아
  `requireSession(token)` 을 첫 줄에서 호출한다. 예외: `apiLogin`.
- 트리거 핸들러는 `trigger*` 접두어. 반드시 try/catch 로 감싸고 실패를 알림로그에 남긴다.
- 외부 API 호출은 `UrlFetchApp.fetch(url, { muteHttpExceptions: true })` 로 하고 상태코드를 직접 검사.
- 시트 쓰기는 행 단위 `appendRow` 반복 금지 — 배열로 모아 `setValues` 1회.
- 사용자에게 보이는 문자열(UI, 알림)은 한국어. 코드 주석은 한국어 또는 영어 자유, 짧게.

## 테스트
- `npm test` = `node --test test/`. 새 `core` 함수에는 테스트를 같이 추가한다.
- NEIS 파서는 실제 응답 샘플 문자열을 `test/fixtures/` 에 두고 테스트한다.
- 커밋/푸시 전 `npm test` 통과 필수.

## clasp 워크플로
- `clasp push` 전에 `npm test`. `clasp push` 후 웹앱 확인은 **테스트 배포(`/dev` URL)** 로,
  실제 사용자용 배포는 사용자가 명시적으로 요청할 때만 `clasp deploy`.
- `.clasp.json`(scriptId 포함)은 `.gitignore` 대상. `appsscript.json` 은 커밋한다.
- `clasp login`, Apps Script API 활성화, OAuth 권한 승인, NEIS 키 발급은 **사용자가 직접** 한다.
  필요한 시점에 무엇을 해야 하는지 정확한 순서로 알려준다.

## 진행 방식
- 단계별로 진행하고 각 단계 끝에 사용자가 직접 해야 할 일을 명시한다.
- 애매한 요구사항은 추측하지 말고 묻는다. 사소한 결정은 합리적으로 정하고 `SPEC.md` 11절에 기록한다.
- 이 저장소에는 개인정보(실제 학생 데이터)를 절대 넣지 않는다. 테스트 데이터는 가상 이름만.
