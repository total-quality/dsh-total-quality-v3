'use strict';

const control = /\{\s*"(?:thought|tool|args|final|answer)"\s*:/;

function clarify(text, scope) {
  if (!/^[\p{P}\p{S}\p{Z}\p{C}]+$/u.test(String(text ?? '').normalize('NFKC').trim())) return null;
  return {
    ok: true, clarification: true, trace: [], pending: [],
    content: scope === 'library'
      ? '你想查哪份文件或哪条要求？可以发文件名或直接描述想核对的内容。'
      : '你想了解什么？可以发工作单编号，或说说想查哪个批次、哪项质量问题。',
  };
}

function parseAction(raw) {
  const response = String(raw ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!response || /<\/?think>/i.test(response)) return {};
  if (!control.test(response)) return { final: response };

  const fence = /^\x60\x60\x60(?:json)?\s*([\s\S]*?)\s*\x60\x60\x60$/i.exec(response);
  try {
    const body = JSON.parse(fence ? fence[1] : response);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
    const final = body.final ?? body.answer;
    if (typeof final === 'string' && !('tool' in body) && !control.test(final) && !/<\/?think>/i.test(final)) {
      return { final: final.trim() };
    }
    if (typeof body.tool === 'string' && body.tool && final === undefined &&
        body.args && typeof body.args === 'object' && !Array.isArray(body.args)) {
      return { tool: body.tool, args: body.args };
    }
  } catch (_) { /* Reject incomplete or multiple protocol envelopes. */ }
  return {};
}

function historyMessage(message) {
  if (message?.role !== 'assistant') return message;
  const parsed = parseAction(message.content);
  return parsed.final
    ? { ...message, content: parsed.final }
    : { ...message, incomplete: true, content: '这条历史回复未完整生成。请重新发送原问题。' };
}

function historyRow(row) {
  return { ...row, messages: Array.isArray(row.messages) ? row.messages.map(historyMessage) : [] };
}

module.exports = { clarify, parseAction, historyRow };
