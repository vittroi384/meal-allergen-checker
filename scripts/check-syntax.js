#!/usr/bin/env node
'use strict';
/** src 아래 .js 와 .html 안의 <script> 블록을 node --check 로 문법 검사한다. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const SRC = path.join(__dirname, '..', 'src');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-check-'));
let failures = 0;
let count = 0;

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.js')) check(p, fs.readFileSync(p, 'utf8'));
    else if (name.endsWith('.html')) {
      const html = fs.readFileSync(p, 'utf8');
      const re = /<script[^>]*>([\s\S]*?)<\/script>/gi;
      let m, i = 0;
      while ((m = re.exec(html))) check(p + '#script' + (++i), m[1]);
    }
  }
}

function check(label, code) {
  count++;
  const file = path.join(tmp, 'chk_' + count + '.js');
  fs.writeFileSync(file, code);
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    failures++;
    console.error('SYNTAX ERROR in ' + path.relative(SRC, label) + '\n' + r.stderr.replace(new RegExp(file.replace(/\\/g, '\\\\'), 'g'), label));
  }
}

walk(SRC);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`checked ${count} scripts, failures=${failures}`);
process.exit(failures ? 1 : 0);
