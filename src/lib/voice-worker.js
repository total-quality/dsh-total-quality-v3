'use strict';

const path = require('node:path');
const { parentPort, workerData } = require('node:worker_threads');
const { OnlineRecognizer } = require('sherpa-onnx-node');

const { modelDir, rate } = workerData;
let recognizer;

function readyRecognizer() {
  recognizer ||= new OnlineRecognizer({
    featConfig: { sampleRate:rate, featureDim:80 },
    modelConfig: {
      transducer: {
        encoder:path.join(modelDir,'encoder.int8.onnx'),
        decoder:path.join(modelDir,'decoder.onnx'),
        joiner:path.join(modelDir,'joiner.int8.onnx'),
      },
      tokens:path.join(modelDir,'tokens.txt'), numThreads:2, provider:'cpu', debug:0,
    },
  });
  return recognizer;
}

function decode(bytes) {
  const samples = new Float32Array(bytes);
  let audible = false;
  for (const sample of samples) {
    if (!Number.isFinite(sample) || Math.abs(sample) > 1.01) throw Error('invalid samples');
    if (Math.abs(sample) > 0.002) audible = true;
  }
  if (!audible) return '';
  const stream = readyRecognizer().createStream();
  try {
    stream.acceptWaveform({sampleRate:rate,samples});
    stream.acceptWaveform({sampleRate:rate,samples:new Float32Array(rate / 2)});
    stream.inputFinished();
    while (recognizer.isReady(stream)) recognizer.decode(stream);
    return String(recognizer.getResult(stream).text || '').trim();
  } finally { stream.free?.(); }
}

parentPort.on('message', ({ id, bytes }) => {
  try {
    if (bytes) parentPort.postMessage({ id, text:decode(bytes) });
    else { readyRecognizer(); parentPort.postMessage({ id }); }
  }
  catch { parentPort.postMessage({ id, error:true }); }
});
