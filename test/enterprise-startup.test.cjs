'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const probe = String.raw`
const http = require('node:http');
const { once } = require('node:events');
const host = require('./host.cjs');
(async () => {
  await host.init();
  const server = http.createServer(host.handle).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port + '/api/';
  const json = async (endpoint) => {
    const response = await fetch(base + endpoint);
    if (!response.ok) throw Error(endpoint + ': HTTP ' + response.status);
    return response.json();
  };
  const [boot, operations, library] = await Promise.all([json('bootstrap'), json('operations'), json('library')]);
  if (process.env.QIP_TEST_ADD_MEMBER === '1') {
    const response = await fetch(base + 'members', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:'试点质检员',dept:'质量部',role:'检验'}),
    });
    if (!response.ok) throw Error(await response.text());
    host.store.saveSync(true);
  }
  console.log(JSON.stringify({badge:boot.hasSampleData, counts:boot.counts, cases:operations.cases.length,
    docs:library.documents.length, people:operations.people}));
  host.operations.stop();
  const closed = once(server, 'close');
  server.close();
  server.closeAllConnections();
  await closed;
  host.store.persist.close();
})().catch((error) => { console.error(error); process.exitCode = 1; });
`;

function start(dataDir, demo = '', addMember = '') {
  const result = spawnSync(process.execPath, ['--input-type=commonjs', '-'], {
    cwd: path.resolve(__dirname, '..'), input: probe, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, QIP_SCALE:'sme', QIP_REAL_V3_DATA_DIR:dataDir,
      QIP_REAL_V3_SEED_DEMO:demo, QIP_TEST_ADD_MEMBER:addMember },
  });
  assert.equal(result.status, 0, result.error?.message || (result.stderr + result.stdout));
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
}

test('new enterprise directories start empty and are never seeded on restart', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qip-enterprise-'));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  const first = start(dir, '', '1');
  assert.equal(first.badge, false);
  assert.ok(Object.values(first.counts).every((count) => count === 0));
  assert.equal(first.cases, 0);
  assert.equal(first.docs, 0);

  const second = start(dir, '1');
  assert.equal(second.badge, false);
  assert.deepEqual(second.people, ['试点质检员']);
  assert.equal(second.counts.measurements, 0);
  assert.equal(second.counts.knowledge, 0);
});

test('an independent demo directory still seeds once and reopens with its label', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qip-demo-'));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  const first = start(dir, '1');
  assert.equal(first.badge, true);
  assert.equal(first.counts.measurements, 600);
  assert.equal(first.docs, 0);
  const second = start(dir);
  assert.equal(second.badge, true);
  assert.equal(second.counts.measurements, first.counts.measurements);
  assert.equal(second.cases, first.cases);
});
