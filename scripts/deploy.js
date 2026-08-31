#!/usr/bin/env node
'use strict';
/**
 * 웹앱 URL 을 고정하기 위한 배포 스크립트.
 *  - .deployment-id 가 있으면:  clasp deploy -i <id> -d "<desc>"   (같은 URL 유지)
 *  - 없으면:                     clasp deploy -d "<desc>" 후 배포 ID 를 .deployment-id 에 저장
 * 사용: npm run deploy -- "설명"
 */
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ID_FILE = path.join(ROOT, '.deployment-id');
const desc = process.argv.slice(2).join(' ') || `deploy ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

function run(cmd) {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { cwd: ROOT, stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8', shell: true });
}

run('npm test');
console.log(run('clasp push --force'));

let id = fs.existsSync(ID_FILE) ? fs.readFileSync(ID_FILE, 'utf8').trim() : '';
if (id) {
  console.log(run(`clasp deploy -i ${id} -d "${desc}"`));
  console.log(`\n기존 배포(${id})를 갱신했습니다. 웹앱 URL 은 그대로입니다.`);
} else {
  const out = run(`clasp deploy -d "${desc}"`);
  console.log(out);
  // 출력 예: "- AKfycb... @3." 또는 "Deployed AKfycb... @3"
  const m = out.match(/(AKfycb[\w-]+)/);
  if (!m) {
    console.error('배포 ID 를 출력에서 찾지 못했습니다. `clasp deployments` 로 확인해 .deployment-id 파일에 저장하세요.');
    process.exit(1);
  }
  id = m[1];
  fs.writeFileSync(ID_FILE, id + '\n');
  console.log(`\n최초 배포 완료. 배포 ID 를 .deployment-id 에 저장했습니다: ${id}`);
  console.log('웹앱 URL: https://script.google.com/macros/s/' + id + '/exec');
  console.log('※ 이후에는 항상 `npm run deploy` 로 재배포하세요. 새 배포를 만들면 URL 이 바뀝니다.');
}
