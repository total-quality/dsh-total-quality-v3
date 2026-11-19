'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { setTimeout: wait } = require('node:timers/promises');
const office = require('../src/lib/office');

test('browser upload accepts a Word original over 100 MB and streams it back intact', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'total-quality-stream-'));
  process.env.QIP_REAL_V3_DATA_DIR = dir;
  const host = require('../host.cjs');
  await host.init();
  const server = http.createServer((req,res) => {
    req.url = req.url.replace(/^\/qip-real-v3\//, '/');
    host.handle(req,res);
  }).listen(0,'127.0.0.1');
  await once(server,'listening');
  const base = 'http://127.0.0.1:' + server.address().port + '/qip-real-v3/api/library';
  const small = office.docxWrite([{ type:'p', text:'夹具复验要求 QV-6318：首件和末件均需测量。' }]);
  // Place bulk padding before the central directory. ZIP offsets for local entries
  // are unchanged and the large original needs no giant in-memory fixture.
  const tail = small.length - 22;
  const directoryOffset = small.readUInt32LE(tail + 16);
  const padding = 102 * 1024 * 1024;
  const after = Buffer.from(small.subarray(directoryOffset));
  after.writeUInt32LE(directoryOffset + padding, after.length - 22 + 16);
  const zeros = Buffer.alloc(1024 * 1024);
  const originalHash = createHash('sha256');
  const payload = async function* () {
    yield small.subarray(0,directoryOffset);
    for (let offset=0; offset<padding; offset+=zeros.length) yield zeros;
    yield after;
  };
  const signal = AbortSignal.timeout(55000);
  const sameOrigin = { Origin:new URL(base).origin };
  const upload = () => fetch(base+'?filename='+encodeURIComponent('大容量验收.docx'),{
    method:'POST', headers:{...sameOrigin,'Content-Type':'application/octet-stream'},
    body:payload(), duplex:'half', signal,
  });
  let id;
  try {
    const uploaded = await upload();
    assert.equal(uploaded.status,202);
    const {document} = await uploaded.json();
    id = document.id;
    assert.equal(document.size,small.length + padding);
    let listed, row;
    for (let i=0; i<100; i++) {
      listed=await (await fetch(base,{headers:sameOrigin,signal})).json();
      row=listed.documents.find((value)=>value.id===id);
      if (row && ['ready','failed'].includes(row.status)) break;
      await wait(70);
    }
    assert.equal(row?.status,'ready',row?.error);
    assert.equal(listed.storage.usedBytes,document.size);
    const search=await (await fetch(base+'/search?q=QV-6318',{headers:sameOrigin,signal})).json();
    assert.equal(search.excerpts[0].documentId,id);
    const download=await fetch(base+'/'+id+'/download',{headers:sameOrigin,signal});
    assert.equal(download.status,200);
    assert.equal(Number(download.headers.get('content-length')),document.size);
    const downloadedHash=createHash('sha256');
    for await (const bytes of download.body) downloadedHash.update(bytes);
    for await (const bytes of payload()) originalHash.update(bytes);
    assert.equal(downloadedHash.digest('hex'),originalHash.digest('hex'));
    const duplicate = await upload();
    assert.equal(duplicate.status,200);
    assert.equal((await duplicate.json()).document.id,id);
  } finally {
    if (id) {
      const removed=await fetch(base+'/'+id,{method:'DELETE',headers:sameOrigin,signal});
      assert.equal(removed.status,200);
      assert.deepEqual(fs.readdirSync(path.join(dir,'knowledge-library-sme-files')),[]);
    }
    host.operations.stop();
    server.closeAllConnections();
    server.close();
  }
});
