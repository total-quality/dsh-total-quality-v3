'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { createVoice } = require('../src/lib/voice');

test('dictation waits for verified speech models before accepting audio', async () => {
  const voice = createVoice();
  const audio = Readable.from([Buffer.alloc(16000)]);
  audio.headers = { 'content-type':'application/octet-stream' };
  assert.equal(voice.status().phase,'setup');
  await assert.rejects(voice.transcribe(audio,new AbortController().signal),
    (error) => error.status === 409 && /模型/.test(error.message));
});

test('voice worklet flushes the final partial buffer once and stops collecting', () => {
  let Capture;
  const messages = [];
  const ctx = {
    Float32Array,
    AudioWorkletProcessor: class { constructor() { this.port={ postMessage:(value)=>messages.push(value) }; } },
    registerProcessor(name, processor) { assert.equal(name,'qip-draft-voice'); Capture=processor; },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/js/voice-capture-worklet.js'),'utf8'),ctx);
  const recorder = new Capture();
  recorder.process([[new Float32Array(2304).fill(0.125)]]);
  assert.equal(messages.length,1);
  assert.equal(messages[0].length,2048);
  recorder.port.onmessage({data:'finish'});
  assert.deepEqual(messages.slice(1).map((x)=>x==='finished'?x:x.length),[256,'finished']);
  assert.equal(messages[1][255],0.125);
  recorder.process([[new Float32Array(2304)]]);
  assert.equal(messages.length,3);
});
