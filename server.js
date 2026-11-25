// 约球运动 App —— 多人共用网页版后端
// 纯 Node.js 内置模块，无任何第三方依赖；数据存在 data.json（JSON 文件数据库）
// 启动：npm start（默认端口 3000，可用环境变量 PORT 覆盖）
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
// 数据文件路径可用环境变量 DB_FILE 覆盖（部署时挂持久化磁盘就改这里）
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// 运动项目白名单（前端筛选与后端校验共用）
const SPORTS = ['篮球', '羽毛球', '足球', '网球', '跑步', '乒乓球', '瑜伽', '其他'];
const CITIES = ['北京', '上海', '广州', '深圳', '成都', '杭州', '武汉', '南京', '其他'];

// ---------- 数据库：data.json，启动时为空，无任何预置假人、假局 ----------
function emptyDb() {
  return { users: [], friends: [], games: [], participants: [], messages: [] };
}
function loadDb() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const db = JSON.parse(raw);
    for (const k of Object.keys(emptyDb())) if (!Array.isArray(db[k])) db[k] = [];
    return db;
  } catch {
    return emptyDb();
  }
}
function saveDb(db) {
  // 先写临时文件再改名，避免写一半损坏数据
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}
function nowIso() { return new Date().toISOString(); }
function newId() { return crypto.randomUUID(); }

// ---------- 小工具 ----------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}
function str(v, max = 100) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}
function bad(res, msg) { return sendJson(res, 400, { ok: false, error: msg }); }

// 把一局游戏拼成前端需要的完整形态（组织者昵称、已报人数、是否是我参加的）
function gameView(db, g, meId) {
  const parts = db.participants.filter((p) => p.gameId === g.id);
  const host = db.users.find((u) => u.id === g.hostId);
  return {
    ...g,
    hostNickname: host ? host.nickname : g.hostNickname || '已注销',
    joinedCount: parts.length,
    joinedByMe: meId ? parts.some((p) => p.userId === meId) : false,
    participants: parts.map((p) => {
      const u = db.users.find((x) => x.id === p.userId);
      return { userId: p.userId, nickname: u ? u.nickname : '已注销', joinedAt: p.joinedAt };
    }),
  };
}

// ---------- 路由 ----------
async function handleApi(req, res, url) {
  const db = loadDb();
  const meId = url.searchParams.get('userId') || '';

  // ---- 资料：创建 / 更新（昵称+城市+运动，登录用，无密码）----
  if (req.method === 'POST' && url.pathname === '/api/profile') {
    const b = await readBody(req);
    const nickname = str(b.nickname, 20);
    const city = str(b.city, 20);
    const identity = str(b.identity, 20);
    const sports = Array.isArray(b.sports) ? b.sports.filter((s) => SPORTS.includes(s)) : [];
    if (!nickname) return bad(res, '昵称不能为空');
    if (!city) return bad(res, '城市不能为空');
    if (!sports.length) return bad(res, '至少选一项常玩运动');
    let user;
    if (b.id) user = db.users.find((u) => u.id === b.id);
    if (user) {
      Object.assign(user, { nickname, city, identity, sports, updatedAt: nowIso() });
    } else {
      user = { id: newId(), nickname, city, identity, sports, createdAt: nowIso(), updatedAt: nowIso() };
      db.users.push(user);
    }
    saveDb(db);
    return sendJson(res, 200, { ok: true, user });
  }
  if (req.method === 'GET' && url.pathname === '/api/profile') {
    const user = db.users.find((u) => u.id === meId);
    if (!user) return sendJson(res, 404, { ok: false, error: '用户不存在' });
    return sendJson(res, 200, { ok: true, user });
  }

  // ---- 汇总状态（首页一次取回局、球友、消息摘要）----
  if (req.method === 'GET' && url.pathname === '/api/state') {
    const games = [...db.games].sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map((g) => gameView(db, g, meId));
    const friends = db.friends.filter((f) => f.ownerId === meId);
    const myGameIds = db.participants.filter((p) => p.userId === meId).map((p) => p.gameId);
    const threads = db.games.filter((g) => myGameIds.includes(g.id)).map((g) => {
      const msgs = db.messages.filter((m) => m.gameId === g.id);
      const last = msgs[msgs.length - 1] || null;
      return { gameId: g.id, title: g.title, lastMessage: last ? last.text : '', lastAt: last ? last.createdAt : g.createdAt };
    });
    return sendJson(res, 200, { ok: true, games, friends, threads, sports: SPORTS, cities: CITIES });
  }

  // ---- 局：列表 / 详情 / 新建 ----
  if (req.method === 'GET' && url.pathname === '/api/games') {
    let list = [...db.games].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const city = url.searchParams.get('city');
    const sport = url.searchParams.get('sport');
    const q = (url.searchParams.get('q') || '').trim();
    if (city && city !== '全部') list = list.filter((g) => g.city === city);
    if (sport && sport !== '全部') list = list.filter((g) => g.sport === sport);
    if (q) list = list.filter((g) => (g.title + g.venue + g.note).includes(q));
    return sendJson(res, 200, { ok: true, games: list.map((g) => gameView(db, g, meId)) });
  }
  if (req.method === 'POST' && url.pathname === '/api/games') {
    const b = await readBody(req);
    const host = db.users.find((u) => u.id === b.userId);
    if (!host) return bad(res, '请先完善个人资料（登录）');
    const title = str(b.title, 60);
    const sport = str(b.sport, 20);
    const venue = str(b.venue, 60);
    const city = str(b.city, 20) || host.city;
    const totalSpots = Number(b.totalSpots);
    if (!title) return bad(res, '标题不能为空');
    if (!SPORTS.includes(sport)) return bad(res, '运动项目不正确');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || ''))) return bad(res, '日期格式应为 YYYY-MM-DD');
    if (!str(b.timeLabel, 30)) return bad(res, '时间不能为空');
    if (!venue) return bad(res, '场馆/地点不能为空');
    if (!Number.isInteger(totalSpots) || totalSpots < 2 || totalSpots > 100) return bad(res, '人数应为 2-100');
    const game = {
      id: newId(), hostId: host.id, hostNickname: host.nickname,
      title, sport, date: b.date, timeLabel: str(b.timeLabel, 30),
      venue, city, district: str(b.district, 20),
      totalSpots, feeText: str(b.feeText, 40), level: str(b.level, 20),
      note: str(b.note, 300), createdAt: nowIso(),
    };
    db.games.push(game);
    // 组织者自动算作已报名成员
    db.participants.push({ gameId: game.id, userId: host.id, joinedAt: nowIso() });
    saveDb(db);
    return sendJson(res, 200, { ok: true, game: gameView(db, game, host.id) });
  }
  const gameIdMatch = url.pathname.match(/^\/api\/games\/([^/]+)$/);
  if (req.method === 'GET' && gameIdMatch) {
    const g = db.games.find((x) => x.id === gameIdMatch[1]);
    if (!g) return sendJson(res, 404, { ok: false, error: '局不存在' });
    return sendJson(res, 200, { ok: true, game: gameView(db, g, meId) });
  }

  // ---- 报名 / 取消报名 ----
  const joinMatch = url.pathname.match(/^\/api\/games\/([^/]+)\/(join|leave)$/);
  if (req.method === 'POST' && joinMatch) {
    const [, gameId, action] = joinMatch;
    const b = await readBody(req);
    const user = db.users.find((u) => u.id === b.userId);
    const g = db.games.find((x) => x.id === gameId);
    if (!user) return bad(res, '请先完善个人资料（登录）');
    if (!g) return sendJson(res, 404, { ok: false, error: '局不存在' });
    const idx = db.participants.findIndex((p) => p.gameId === gameId && p.userId === user.id);
    if (action === 'join') {
      if (idx >= 0) return sendJson(res, 200, { ok: true, game: gameView(db, g, user.id), already: true });
      const count = db.participants.filter((p) => p.gameId === gameId).length;
      if (count >= g.totalSpots) return sendJson(res, 400, { ok: false, error: '人数已满' });
      db.participants.push({ gameId, userId: user.id, joinedAt: nowIso() });
    } else {
      if (idx < 0) return sendJson(res, 200, { ok: true, game: gameView(db, g, user.id), already: true });
      if (g.hostId === user.id) return bad(res, '组织者不能取消报名，可删除本局或转让给他人');
      db.participants.splice(idx, 1);
    }
    saveDb(db);
    return sendJson(res, 200, { ok: true, game: gameView(db, g, user.id) });
  }

  // ---- 球友：列表 / 添加 / 邀请切换 / 移除 ----
  if (req.method === 'GET' && url.pathname === '/api/friends') {
    if (!meId) return bad(res, '缺少 userId');
    return sendJson(res, 200, { ok: true, friends: db.friends.filter((f) => f.ownerId === meId) });
  }
  if (req.method === 'POST' && url.pathname === '/api/friends') {
    const b = await readBody(req);
    const owner = db.users.find((u) => u.id === b.userId);
    if (!owner) return bad(res, '请先完善个人资料（登录）');
    const nickname = str(b.nickname, 20);
    if (!nickname) return bad(res, '球友昵称不能为空');
    if (db.friends.some((f) => f.ownerId === owner.id && f.nickname === nickname)) {
      return bad(res, '这位球友已经在你的名单里了');
    }
    const friend = {
      id: newId(), ownerId: owner.id, nickname,
      relation: str(b.relation, 20) || '朋友',
      sports: Array.isArray(b.sports) ? b.sports.filter((s) => SPORTS.includes(s)) : [],
      invited: false, createdAt: nowIso(),
    };
    db.friends.push(friend);
    saveDb(db);
    return sendJson(res, 200, { ok: true, friend });
  }
  const friendMatch = url.pathname.match(/^\/api\/friends\/([^/]+)(?:\/(invite))?$/);
  if (friendMatch && (req.method === 'POST' || req.method === 'DELETE')) {
    const [, friendId, sub] = friendMatch;
    const idx = db.friends.findIndex((f) => f.id === friendId);
    if (idx < 0) return sendJson(res, 404, { ok: false, error: '球友不存在' });
    if (req.method === 'DELETE') {
      db.friends.splice(idx, 1);
      saveDb(db);
      return sendJson(res, 200, { ok: true });
    }
    if (sub === 'invite') {
      const b = await readBody(req);
      db.friends[idx].invited = b.invited !== false;
      saveDb(db);
      return sendJson(res, 200, { ok: true, friend: db.friends[idx] });
    }
  }

  // ---- 群聊消息：按局取 / 发送 ----
  const msgMatch = url.pathname.match(/^\/api\/games\/([^/]+)\/messages$/);
  if (msgMatch) {
    const gameId = msgMatch[1];
    const g = db.games.find((x) => x.id === gameId);
    if (!g) return sendJson(res, 404, { ok: false, error: '局不存在' });
    if (req.method === 'GET') {
      const list = db.messages.filter((m) => m.gameId === gameId)
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      return sendJson(res, 200, { ok: true, messages: list });
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      const user = db.users.find((u) => u.id === b.userId);
      if (!user) return bad(res, '请先完善个人资料（登录）');
      const text = str(b.text, 500);
      if (!text) return bad(res, '消息不能为空');
      const isMember = db.participants.some((p) => p.gameId === gameId && p.userId === user.id);
      if (!isMember) return sendJson(res, 403, { ok: false, error: '只有本局成员才能在群里发言' });
      const msg = { id: newId(), gameId, userId: user.id, nickname: user.nickname, text, createdAt: nowIso() };
      db.messages.push(msg);
      saveDb(db);
      return sendJson(res, 200, { ok: true, message: msg });
    }
  }

  return sendJson(res, 404, { ok: false, error: '接口不存在' });
}

// ---------- 静态文件 ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
function serveStatic(req, res, url) {
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  const safe = path.normalize(path.join(PUBLIC_DIR, file));
  if (!safe.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(safe, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('页面不存在'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(safe)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname === '/health') return sendJson(res, 200, { ok: true, app: 'yueqiu-app' });
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: '服务器内部错误' });
  }
});

server.listen(PORT, () => {
  console.log(`约球 App 已启动：http://localhost:${PORT}`);
  console.log(`数据文件：${DB_FILE}（启动时为空，只有大家真实提交的数据）`);
});
