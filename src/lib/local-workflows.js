'use strict';

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function required(value, label, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('请填写有效的' + label);
  return value.trim();
}

function decide(store, collection, id, input) {
  const row = store.col(collection).get(id);
  if (!row) fail('记录不存在', 404);
  const at = new Date().toISOString();
  const author = required(input?.author, '经办人', 100);
  const note = required(input?.note, '处理依据');
  const action = input.action;

  return store.transaction(() => {
    let closeTodos = false;
    if (collection === 'qrqc') {
      if (row.status === 'closed') fail('该 QRQC 已闭环', 409);
      if (action === 'respond') {
        if (row.respondedAt) fail('该 QRQC 已记录首次响应', 409);
        Object.assign(row, { respondedAt: at, respondedBy: author, responseNote: note });
      } else if (action === 'close') {
        if (!row.respondedAt && !row.responseAt) fail('请先记录实际响应');
        if (store.col('todos').find((t) => t.link === id && !t.done).length) fail('请先完成关联任务');
        Object.assign(row, { status: 'closed', closedAt: at, closedBy: author, closureNote: note });
      } else fail('未知 QRQC 操作');
    } else if (collection === 'benefits') {
      if (!['verify', 'reject'].includes(action)) fail('请选择核定结果');
      if (row.status !== 'pending') fail('只有待核定记录可处理', 409);
      const amount = action === 'verify' ? Number(input.amount) : row.amount;
      if (action === 'verify' && (!String(input.amount ?? '').trim() || !Number.isFinite(amount) || amount < 0)) fail('请填写有效的核定金额');
      Object.assign(row, { submittedAmount: row.submittedAmount ?? row.amount, amount, status: action === 'verify' ? 'verified' : 'rejected', verifiedBy: author, verifiedAt: at, verificationNote: note });
      closeTodos = true;
    } else if (collection === 'workflows') {
      if (row.operationsId) fail('请在质量工作单中复核此流程', 409);
      if (!['approve', 'reject'].includes(action)) fail('请选择审批结果');
      if (row.status !== 'pending') fail('只有待审批记录可处理', 409);
      const status = action === 'approve' ? 'approved' : 'rejected';
      const pending = (row.approvers || []).filter((person) => person.status === 'pending');
      const approver = pending.find((person) => person.name === author);
      if ((row.approvers || []).length && !approver) fail('请选择当前待审批人');
      if (approver) Object.assign(approver, { status, at, note });
      const finished = action === 'reject' || pending.length <= 1;
      Object.assign(row, { status: finished ? status : 'pending', reviewedBy: author, reviewedAt: at, reviewNote: note });
      closeTodos = finished;
      if (!finished) {
        for (const todo of store.col('todos').find((t) => t.link === id && t.user === author)) todo.done = true;
      }
    } else fail('未知业务集合');
    if (closeTodos) for (const todo of store.col('todos').find((t) => t.link === id)) todo.done = true;
    store.audit({ user: author, plugin: '本地业务', action, params: { id }, resultSummary: note, purpose: '站内人工处理' });
    return row;
  });
}

function saveMember(store, id, input) {
  const members = store.col('members');
  const row = id ? members.get(id) : null;
  if (id && !row) fail('人员不存在', 404);
  const fields = {};
  for (const [key, label, limit] of [['name', '姓名', 80], ['dept', '部门', 100], ['role', '岗位', 100]]) {
    if (!row || Object.hasOwn(input, key)) fields[key] = required(input[key], label, limit);
  }
  const name = fields.name ?? row?.name;
  const dept = fields.dept ?? row?.dept;
  if ((!row || name !== row.name || dept !== row.dept) &&
      members.find((member) => member.name === name && member.dept === dept && member.id !== id).length) fail('同一部门已有同名人员', 409);
  if (input.seniority === '' || input.seniority === null) fields.seniority = null;
  else if (input.seniority !== undefined) {
    const years = Number(input.seniority);
    if (!Number.isFinite(years) || years < 0 || years > 90) fail('司龄须在 0–90 年之间');
    fields.seniority = years;
  }
  for (const key of ['expert', 'skills', 'phone']) {
    if (Object.hasOwn(input, key)) fields[key] = input[key];
  }
  return store.transaction(() => row ? members.update(id, fields) : members.insert(fields));
}

function updateTodo(store, id, patch) {
  const todo = store.col('todos').get(id);
  if (!todo) return null;
  if (patch.done === undefined) return store.col('todos').update(id, patch);
  if (typeof patch.done !== 'boolean') fail('待办完成状态须为布尔值');
  if (todo.operationsId || (todo.link && (store.col('workflows').get(todo.link) || store.col('benefits').get(todo.link)))) {
    fail('请在关联业务单中完成处理', 409);
  }
  const qrqc = todo.link && store.col('qrqc').get(todo.link);
  if (qrqc?.status === 'closed') fail('该 QRQC 已闭环', 409);
  return store.transaction(() => {
    const task = qrqc?.tasks?.find((item) => item.todoId === id);
    if (task) task.done = patch.done;
    return store.col('todos').update(id, patch);
  });
}

function recordGrowth(store, id, input) {
  const row = store.col('members').get(id);
  if (!row) fail('人员不存在', 404);
  const stage = required(input?.stage, '阶段', 20);
  if (!['30 天', '60 天', '90 天', '日常训练'].includes(stage)) fail('请选择有效的成长阶段');
  const summary = required(input.summary, '记录内容');
  const reviewer = required(input.reviewer, '记录人', 100);
  return store.transaction(() => {
    const growth = [...(row.growth || []), { stage, summary, reviewer, at: new Date().toISOString() }];
    store.col('members').update(id, { growth });
    return growth.at(-1);
  });
}

module.exports = { decide, saveMember, recordGrowth, updateTodo };
