'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const DAY = 86400000;
const COOKIE = 'qip_v3_signer';
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const deny = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

function createIdentity(store) {
  let directory, state;
  const sessions = new Map();
  const failures = new Map();
  function read() {
    if (directory === store.dir && state) return state;
    directory = store.dir;
    sessions.clear();
    const file = path.join(directory, 'signing-accounts.json');
    try { state = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      state = { accounts: [], delegations: [] };
    }
    return state;
  }
  function save(data) {
    const file = path.join(directory, 'signing-accounts.json');
    fs.writeFileSync(file + '.tmp', JSON.stringify(data), { mode: 0o600, flush: true });
    fs.renameSync(file + '.tmp', file);
    state = data;
  }
  const publicAccount = ({ id, username, memberId, name, role }) => ({ id, username, memberId, name, role });
  const named = (account) => ({ ...publicAccount(account), name: store.col('members').get(account.memberId)?.name || account.name });
  const configured = () => read().accounts.length > 0;
  const loopback = (req) => {
    try {
      return ['127.0.0.1','localhost','[::1]'].includes(new URL('http://' + req.headers.host).hostname) &&
        ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) &&
        !req.headers.forwarded && !req.headers['x-forwarded-for'];
    } catch { return false; }
  };
  function sameOrigin(req) {
    if (!req.headers.origin) return;
    let host;
    try { host = new URL(req.headers.origin).host; } catch {}
    if (host !== req.headers.host || req.headers['sec-fetch-site'] === 'cross-site') deny('请求来源不匹配', 403);
  }
  function enroll(input, setup = false) {
    const data = structuredClone(read());
    if (setup && data.accounts.length) deny('签核账号已经启用', 409);
    const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
    if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)) deny('账号需使用 3～40 位字母、数字、点或横线');
    if (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 128) deny('密码须为 12～128 个字符');
    const member = store.col('members').get(input.memberId);
    if (!member) deny('请选择团队成员');
    const role = setup ? 'manager' : input.role;
    if (!['manager','worker'].includes(role)) deny('请选择签核角色');
    if (data.accounts.some((a) => a.username === username || a.memberId === member.id)) deny('员工或账号已登记', 409);
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = crypto.scryptSync(input.password, salt, 64).toString('hex');
    const account = { id: crypto.randomUUID(), username, memberId: member.id, name: member.name, role, salt, passwordHash };
    data.accounts.push(account);
    save(data);
    return account;
  }
  function changePassword(who, targetId, input) {
    const data = structuredClone(read());
    const account = data.accounts.find((a)=>a.id===targetId);
    if (!account) deny('员工账号不存在',404);
    const self = account.id === who.id;
    if (!self && who.role !== 'manager') deny('该操作需要质量主管',403);
    if (self) {
      const prior = typeof input.currentPassword === 'string' && input.currentPassword.length <= 128 ? input.currentPassword : '';
      if (!crypto.timingSafeEqual(crypto.scryptSync(prior,account.salt,64),Buffer.from(account.passwordHash,'hex'))) deny('当前密码不正确',401);
    }
    if (typeof input.password!=='string' || input.password.length<12 || input.password.length>128) deny('新密码须为 12～128 个字符');
    account.salt=crypto.randomBytes(16).toString('hex');
    account.passwordHash=crypto.scryptSync(input.password,account.salt,64).toString('hex');
    save(data);
    for (const [key,session] of sessions) if (session.id===account.id) sessions.delete(key);
    return named(account);
  }
  function cookie(res, value, age, req) {
    res.setHeader('Set-Cookie', COOKIE + '=' + value + '; Path=/qip-real-v3/api; HttpOnly; SameSite=Strict; Max-Age=' + age +
      (req.socket.encrypted ? '; Secure' : ''));
  }
  function startSession(req, res, account) {
    logout(req, res);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(hash(token), { id: account.id, until: Date.now() + 8 * 3600000 });
    cookie(res, token, 8 * 3600, req);
    return named(account);
  }
  const tokenFor = (req) => (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  function actor(req) {
    const data = read();
    const token = tokenFor(req);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const key = hash(token);
    const session = sessions.get(key);
    if (!session || session.until < Date.now()) { sessions.delete(key); return null; }
    const account = data.accounts.find((a) => a.id === session.id);
    return account && store.col('members').get(account.memberId) ? named(account) : null;
  }
  function login(req, res, input) {
    const now = Date.now();
    for (const [key, value] of failures) if (value.until <= now) failures.delete(key);
    for (const [key, value] of sessions) if (value.until <= now) sessions.delete(key);
    const ip = req.socket.remoteAddress;
    const failure = failures.get(ip) || { count: 0, until: now + 10 * 60000 };
    if (failure.count >= 12) deny('尝试次数过多，请过几分钟再试', 429);
    const user = typeof input.username === 'string' && input.username.trim().toLowerCase();
    const account = read().accounts.find((a) => a.username === user);
    const password = typeof input.password === 'string' && input.password.length <= 128 ? input.password : '';
    const derived = crypto.scryptSync(password, account?.salt || '00000000000000000000000000000000', 64);
    if (!account || !crypto.timingSafeEqual(derived, Buffer.from(account.passwordHash,'hex')) || !store.col('members').get(account.memberId)) {
      failure.count++;
      failures.set(ip, failure);
      deny('员工账号或密码不正确', 401);
    }
    failures.delete(ip);
    return startSession(req, res, account);
  }
  function logout(req, res) {
    const token = tokenFor(req);
    if (token) sessions.delete(hash(token));
    cookie(res, '', 0, req);
  }
  function directoryView() {
    const data = read();
    return { accounts: data.accounts.map(named), delegations: data.delegations };
  }
  function delegate(who, input) {
    const data = structuredClone(read());
    const target = data.accounts.find((a) => a.id === input.accountId && a.role === who.role && a.id !== who.id);
    const until = Date.parse(input.until);
    const reason = typeof input.reason === 'string' && input.reason.trim();
    if (!target || !Number.isFinite(until) || until <= Date.now() || until > Date.now() + 90 * DAY ||
      !reason || reason.length > 300) deny('请选择同角色代理人，填写原因和 90 天内的截止时间');
    const row = { id: crypto.randomUUID(), principalId: who.id, deputyId: target.id, until: new Date(until).toISOString(),
      reason, grantedAt: new Date().toISOString() };
    data.delegations.push(row);
    save(data);
    return row;
  }
  function revoke(who, id) {
    const data = structuredClone(read());
    const row = data.delegations.find((d) => d.id === id && d.principalId === who.id && !d.revokedAt);
    if (!row) deny('授权不存在或已撤销', 404);
    row.revokedAt = new Date().toISOString();
    save(data);
    return row;
  }
  function signingActor(who, id) {
    if (!id) return { ...who, actingFor: null };
    const data = read();
    const grant = data.delegations.find((d) => d.id === id && d.deputyId === who.id && !d.revokedAt && Date.parse(d.until) > Date.now());
    const principal = grant && data.accounts.find((a) => a.id === grant.principalId);
    if (!principal || principal.role !== who.role || !store.col('members').get(principal.memberId)) deny('该代理授权失效', 403);
    return { ...who, actingFor: named(principal), delegationId: grant.id, delegationReason: grant.reason };
  }
  function visible(req) {
    const who = actor(req);
    const data = read();
    const members = store.col('members').all().map(({ id,name }) => ({ id,name }));
    return { configured: configured(), actor: who, setupAllowed: !configured() && loopback(req),
      members: (who?.role === 'manager' || !configured() && loopback(req)) ? members : [],
      availableDelegations: who ? data.delegations.filter((d) => !d.revokedAt && d.deputyId === who.id && Date.parse(d.until) > Date.now())
        .map((d) => { const account=named(data.accounts.find((a)=>a.id===d.principalId)); return {id:d.id,name:account.name,memberId:account.memberId,until:d.until}; }) : [],
      ownDelegations: who ? data.delegations.filter((d) => d.principalId === who.id).map((d) => ({ ...d, name:named(data.accounts.find((a) => a.id === d.deputyId)).name })) : [],
      peers: who ? data.accounts.filter((a) => a.id !== who.id && a.role === who.role).map(named) : [] };
  }
  return { configured, loopback, sameOrigin, actor, enroll, changePassword, startSession, login, logout, directoryView, delegate, revoke, signingActor, visible,
    memberHasAccount: (id) => read().accounts.some((a) => a.memberId === id),
    invalidate: () => sessions.clear(), publicAccount };
}
module.exports = { createIdentity };
