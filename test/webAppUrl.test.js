'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./helpers/loadCore');

const core = loadCore();
const ID = 'AKfycbExampleDeployId0000000000000000000000000000000000000000000000000000000';
const STD = `https://script.google.com/macros/s/${ID}/exec`;

test('normalizeWebAppUrl: /a/macros/{domain}/s/... → /macros/s/...', () => {
  assert.strictEqual(core.normalizeWebAppUrl(`https://script.google.com/a/macros/exampleschool.kr/s/${ID}/exec`), STD);
});

test('normalizeWebAppUrl: /a/{domain}/macros/s/... → /macros/s/...', () => {
  assert.strictEqual(core.normalizeWebAppUrl(`https://script.google.com/a/exampleschool.kr/macros/s/${ID}/exec`), STD);
});

test('normalizeWebAppUrl: keeps /dev suffix and query string', () => {
  assert.strictEqual(core.normalizeWebAppUrl(`https://script.google.com/a/macros/exampleschool.kr/s/${ID}/dev?x=1`),
    `https://script.google.com/macros/s/${ID}/dev?x=1`);
});

test('normalizeWebAppUrl: standard URL unchanged, whitespace trimmed, empty → ""', () => {
  assert.strictEqual(core.normalizeWebAppUrl(STD), STD);
  assert.strictEqual(core.normalizeWebAppUrl('  ' + STD + '\n'), STD);
  assert.strictEqual(core.normalizeWebAppUrl(''), '');
  assert.strictEqual(core.normalizeWebAppUrl(null), '');
  assert.strictEqual(core.normalizeWebAppUrl('https://example.com/a/macros/x/s/y/exec'), 'https://example.com/a/macros/x/s/y/exec');
});

test('extractDeploymentId: exec only (org form normalized first), dev/HEAD → ""', () => {
  assert.strictEqual(core.extractDeploymentId(STD), ID);
  assert.strictEqual(core.extractDeploymentId(STD + '?page=1'), ID);
  assert.strictEqual(core.extractDeploymentId(`https://script.google.com/a/macros/exampleschool.kr/s/${ID}/exec`), ID);
  assert.strictEqual(core.extractDeploymentId(`https://script.google.com/macros/s/${ID}/dev`), '');
  assert.strictEqual(core.extractDeploymentId(''), '');
  assert.strictEqual(core.extractDeploymentId('https://example.com/macros/s/x/exec'), '');
});

test('buildWebAppUrl', () => {
  assert.strictEqual(core.buildWebAppUrl(ID), STD);
  assert.strictEqual(core.buildWebAppUrl(' ' + ID + ' '), STD);
  assert.strictEqual(core.buildWebAppUrl(''), '');
});

test('isOrgWebAppUrl', () => {
  assert.strictEqual(core.isOrgWebAppUrl(`https://script.google.com/a/macros/exampleschool.kr/s/${ID}/exec`), true);
  assert.strictEqual(core.isOrgWebAppUrl(STD), false);
  assert.strictEqual(core.isOrgWebAppUrl(''), false);
});
