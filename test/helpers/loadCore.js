'use strict';
/**
 * src/core/*.js 를 Apps Script 와 동일하게 "하나의 공유 스코프"에 순서대로 로드한다.
 * 모든 파일을 이어붙여 함수 하나의 본문으로 평가하므로 최상위 function/var 선언이 서로 보인다.
 * (vm 컨텍스트 대신 같은 realm 에서 평가 → assert.deepStrictEqual 이 Array/Object 프로토타입을 그대로 비교 가능)
 * 반환값은 Proxy — core.parseDishString 처럼 전역 식별자를 그대로 꺼내 쓸 수 있다.
 */
const fs = require('node:fs');
const path = require('node:path');

const CORE_DIR = path.join(__dirname, '..', '..', 'src', 'core');

function loadCore() {
  const files = fs.readdirSync(CORE_DIR).filter((f) => f.endsWith('.js')).sort();
  const body = files
    .map((f) => `// ---- ${f} ----\n${fs.readFileSync(path.join(CORE_DIR, f), 'utf8')}`)
    .join('\n');
  // 비엄격 함수 안의 직접 eval 은 지역 스코프(= 로드된 모든 선언)를 볼 수 있다.
  // eslint-disable-next-line no-new-func
  const getter = new Function(`${body}\nreturn function __coreGet(__name) { return eval(__name); };`)();
  return new Proxy(
    {},
    {
      get(_, name) {
        if (typeof name !== 'string') return undefined;
        try {
          return getter(name);
        } catch (e) {
          if (e instanceof ReferenceError) return undefined;
          throw e;
        }
      },
    },
  );
}

module.exports = { loadCore };
