// 约球 App 前端：所有数据都走后端 /api，存在共享数据库里
// 当前登录用户存在 localStorage（昵称+城市+运动，无密码）
const $ = (s) => document.querySelector(s);
const SPORTS = ['篮球', '羽毛球', '足球', '网球', '跑步', '乒乓球', '瑜伽', '其他'];
const CITIES = ['北京', '上海', '广州', '深圳', '成都', '杭州', '武汉', '南京', '其他'];
let me = JSON.parse(localStorage.getItem('yueqiu_user') || 'null');
let state = { games: [], friends: [], threads: [], invites: [] };
let currentSport = '全部';
let currentGameId = null;
let currentGameJoined = false;
let setupSports = new Set(), mySports = new Set(), friendSports = new Set();

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 4000);
}
// 资料页的常驻错误提示：一直显示，直到用户改对为止（不再只靠一闪而过的 toast）
function showSetupError(msg) {
  const e = $('#setupError'); e.textContent = msg; e.hidden = false;
}
function clearSetupError() { $('#setupError').hidden = true; }
async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || '请求失败');
  return j;
}
// 场馆 → 高德地图搜索链接（国内用高德；手机装了高德 App 会直接打开 App，没装就打开网页版地图）
function mapUrl(venue, city) {
  return 'https://uri.amap.com/search?keyword=' + encodeURIComponent([venue, city].filter(Boolean).join(' '));
}
function venueLink(g) {
  return `<a class="venue-link" href="${mapUrl(g.venue, g.city)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">📍${g.venue}</a>`;
}
function chipRow(el, items, selected, onPick) {
  el.innerHTML = '';
  items.forEach((it) => {
    const b = document.createElement('button');
    b.className = 'chip' + (selected.has ? (selected.has(it) ? ' on' : '') : (selected === it ? ' on' : ''));
    b.textContent = it;
    b.onclick = () => onPick(it);
    el.appendChild(b);
  });
}
function fillCities(sel, value) {
  sel.innerHTML = CITIES.map((c) => `<option ${c === value ? 'selected' : ''}>${c}</option>`).join('');
}

// ---------- 登录 / 资料 ----------
function showSetup() {
  $('#view-setup').hidden = false; $('#main').hidden = true; $('#tabbar').hidden = true;
  $('#setupNickname').value = ''; $('#setupIdentity').value = '';
  setupSports = new Set(); clearSetupError();
  fillCities($('#setupCity'), '北京');
  renderSetupSports();
}
function renderSetupSports() {
  chipRow($('#setupSports'), SPORTS, setupSports, (s) => { setupSports.has(s) ? setupSports.delete(s) : setupSports.add(s); renderSetupSports(); });
  $('#setupSportsPicked').textContent = setupSports.size ? '已选：' + [...setupSports].join('、') : '';
  if (setupSports.size) clearSetupError();
}
function renderMySports() { chipRow($('#mySports'), SPORTS, mySports, (s) => { mySports.has(s) ? mySports.delete(s) : mySports.add(s); renderMySports(); }); }
function renderFriendSports() { chipRow($('#fSports'), SPORTS, friendSports, (s) => { friendSports.has(s) ? friendSports.delete(s) : friendSports.add(s); renderFriendSports(); }); }

async function saveProfile(data) {
  const j = await api('/api/profile', { method: 'POST', body: JSON.stringify(data) });
  me = j.user;
  localStorage.setItem('yueqiu_user', JSON.stringify(me));
  return me;
}
$('#setupNickname').addEventListener('input', () => { if ($('#setupNickname').value.trim()) clearSetupError(); });
$('#setupSave').onclick = async () => {
  // 先在本地校验：缺什么就直接在按钮下面写清楚，不发请求、不静默失败
  const btn = $('#setupSave');
  if (!$('#setupNickname').value.trim()) { showSetupError('请先填一个昵称，再点“开始约球”。'); $('#setupNickname').focus(); return; }
  if (!setupSports.size) { showSetupError('请点一下上面的“常玩运动”，至少选一项，再点“开始约球”。'); return; }
  btn.disabled = true; btn.textContent = '正在进入…';
  try {
    await saveProfile({ nickname: $('#setupNickname').value, city: $('#setupCity').value, identity: $('#setupIdentity').value, sports: [...setupSports] });
    clearSetupError(); enterApp(); toast('欢迎加入，' + me.nickname);
  } catch (e) { showSetupError(e.message || '没能保存，请检查网络后重试。'); toast(e.message); }
  btn.disabled = false; btn.textContent = '开始约球';
};

// ---------- 进入主界面 ----------
function enterApp() {
  $('#view-setup').hidden = true; $('#main').hidden = false; $('#tabbar').hidden = false;
  $('#myCity').textContent = me.city + ' · ' + me.nickname;
  fillCities($('#cityFilter'), '全部'); $('#cityFilter').insertAdjacentHTML('afterbegin', '<option>全部</option>');
  fillCities($('#myCitySel'), me.city); fillCities($('#cCity'), me.city);
  $('#cSport').innerHTML = SPORTS.map((s) => `<option>${s}</option>`).join('');
  $('#myNickname').value = me.nickname; $('#myIdentity').value = me.identity || '';
  mySports = new Set(me.sports || []); renderMySports(); renderFriendSports();
  showView('discover'); loadAll();
}
function showView(name) {
  ['discover', 'create', 'friends', 'messages', 'my'].forEach((v) => { $('#view-' + v).hidden = v !== name; });
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
}
document.querySelectorAll('#tabbar button').forEach((b) => b.onclick = () => { showView(b.dataset.view); if (b.dataset.view === 'messages') loadAll(); });

// ---------- 数据加载与渲染 ----------
async function loadAll() {
  try {
    const j = await api(`/api/state?userId=${me.id}`);
    state = j; renderGames(); renderFriends(); renderThreads(); renderInvites(); renderMyGames();
  } catch (e) { toast(e.message); }
}
function filteredGames() {
  const q = $('#searchInput').value.trim();
  const city = $('#cityFilter').value;
  return state.games.filter((g) =>
    (city === '全部' || g.city === city) &&
    (currentSport === '全部' || g.sport === currentSport) &&
    (!q || (g.title + g.venue + (g.note || '')).includes(q)));
}
function renderGames() {
  const list = filteredGames();
  $('#emptyGames').hidden = list.length > 0;
  $('#gameList').innerHTML = '';
  chipRow($('#sportFilter'), ['全部', ...SPORTS], currentSport, (s) => { currentSport = s; renderGames(); });
  list.forEach((g) => {
    const el = document.createElement('div');
    el.className = 'card game-card';
    const pct = Math.round((g.joinedCount / g.totalSpots) * 100);
    el.innerHTML = `<h3>${g.title}</h3>
      <div class="meta"><span class="tag">${g.sport}</span>${g.date} ${g.timeLabel}<br>${venueLink(g)} · ${g.city} ${g.district || ''}<br>组织者：${g.hostNickname} · ${g.feeText || '费用待定'}</div>
      <div class="spots">已报名 ${g.joinedCount}/${g.totalSpots} 人${g.joinedByMe ? ' · 你已报名' : ''}</div>
      <div class="bar"><i style="width:${pct}%"></i></div>`;
    el.onclick = () => openDetail(g.id);
    $('#gameList').appendChild(el);
  });
}
$('#searchInput').oninput = renderGames;
$('#cityFilter').onchange = renderGames;

// ---------- 局详情 + 群聊 ----------
async function openDetail(gameId) {
  currentGameId = gameId;
  const j = await api(`/api/games/${gameId}?userId=${me.id}`);
  const g = j.game;
  const msgs = await api(`/api/games/${gameId}/messages`);
  $('#detailContent').innerHTML = `<h2>${g.title}</h2>
    <div class="meta"><span class="tag">${g.sport}</span>${g.date} ${g.timeLabel}<br>${venueLink(g)} · ${g.city} ${g.district || ''}<br>组织者：${g.hostNickname} · ${g.feeText || ''} · ${g.level || ''}</div>
    <p class="hint">${g.note || ''}</p>
    <div class="spots">已报名 ${g.joinedCount}/${g.totalSpots} 人</div>
    <p>成员：${g.participants.map((p) => p.nickname).join('、') || '暂无'}</p>
    <button class="primary" id="joinBtn">${g.joinedByMe ? '取消报名' : (g.joinedCount >= g.totalSpots ? '已满员' : '立即报名')}</button>
    ${g.joinedByMe ? `<div class="invite-box"><label>邀请球友 <select id="inviteFriendSel">${(state.friends || []).map((f) => `<option>${f.nickname}</option>`).join('')}</select></label>
    <button id="inviteSendBtn">发邀请</button><span id="inviteMsg" class="hint"></span>
    ${(state.friends || []).length ? '' : '<p class="hint">先去「球友」页加好友，再来邀请。</p>'}</div>` : ''}`;
  $('#chatList').innerHTML = msgs.messages.map((m) => `<div class="msg"><b>${m.nickname}：</b>${m.text}</div>`).join('') || '<p class="hint">群里还没有消息。</p>';
  // 没报名的人看得到群聊，但发不了言：直接在输入框上方写清楚，而不是点了发送才闪一下报错
  currentGameJoined = !!g.joinedByMe;
  $('#chatInput').disabled = !currentGameJoined;
  $('#chatSend').disabled = !currentGameJoined;
  const hint = $('#chatHint');
  if (currentGameJoined) { hint.hidden = true; }
  else { hint.textContent = '你是游客，先点上面的「立即报名」加入这局，才能在群里发言。'; hint.hidden = false; }
  $('#detail').hidden = false;
  $('#joinBtn').onclick = async () => {
    try {
      const action = g.joinedByMe ? 'leave' : 'join';
      await api(`/api/games/${gameId}/${action}`, { method: 'POST', body: JSON.stringify({ userId: me.id }) });
      toast(g.joinedByMe ? '已取消报名' : '报名成功'); loadAll(); openDetail(gameId);
    } catch (e) { toast(e.message); }
  };
  const inviteBtn = $('#inviteSendBtn');
  if (inviteBtn) {
    inviteBtn.onclick = async () => {
      const nickname = $('#inviteFriendSel').value;
      const msg = $('#inviteMsg');
      inviteBtn.disabled = true;
      try {
        await api('/api/invites', { method: 'POST', body: JSON.stringify({ userId: me.id, nickname, gameId }) });
        msg.textContent = `邀请已发给 ${nickname}，对方在「消息」里能看到。`;
        toast('邀请已发出');
      } catch (e) { msg.textContent = e.message; toast(e.message); }
      inviteBtn.disabled = false;
    };
  }
}
$('#detailClose').onclick = () => { $('#detail').hidden = true; };
$('#detailBack').onclick = () => { $('#detail').hidden = true; };
// 点弹窗外面的暗色区域也能关掉，不会被卡在群聊里
$('#detail').addEventListener('click', (e) => { if (e.target === $('#detail')) $('#detail').hidden = true; });
// “我的”页退出登录：清掉本机保存的资料，回到最初的介绍页
$('#logoutBtn').onclick = () => {
  if (!confirm('退出后要重新填昵称才能进来，确定吗？')) return;
  localStorage.removeItem('yueqiu_user'); me = null;
  $('#detail').hidden = true; showSetup();
};
$('#chatSend').onclick = async () => {
  const text = $('#chatInput').value.trim();
  if (!text || !currentGameId) return;
  if (!currentGameJoined) {
    const hint = $('#chatHint');
    hint.textContent = '先点上面的「立即报名」加入这局，才能在群里发言。';
    hint.hidden = false; return;
  }
  const btn = $('#chatSend'); btn.disabled = true; btn.textContent = '发送中…';
  try {
    await api(`/api/games/${currentGameId}/messages`, { method: 'POST', body: JSON.stringify({ userId: me.id, text }) });
    $('#chatInput').value = ''; openDetail(currentGameId);
  } catch (e) {
    const hint = $('#chatHint');
    hint.textContent = e.message || '发送失败，请重试。'; hint.hidden = false; toast(e.message);
  }
  btn.disabled = !currentGameJoined; btn.textContent = '发送';
};

// ---------- 发起 ----------
// 填场馆时实时更新“在高德地图中查看”链接，点开就能确认是不是那个地方
function updateVenueMapLink() {
  const link = $('#venueMapLink');
  const venue = $('#cVenue').value.trim();
  link.hidden = !venue;
  if (venue) link.href = mapUrl(venue, $('#cCity').value.trim());
}
$('#cVenue').addEventListener('input', updateVenueMapLink);
$('#cCity').addEventListener('input', updateVenueMapLink);
$('#createBtn').onclick = async () => {
  try {
    const j = await api('/api/games', { method: 'POST', body: JSON.stringify({
      userId: me.id, title: $('#cTitle').value, sport: $('#cSport').value, date: $('#cDate').value,
      timeLabel: $('#cTime').value, venue: $('#cVenue').value, city: $('#cCity').value,
      totalSpots: Number($('#cSpots').value), feeText: $('#cFee').value, level: $('#cLevel').value, note: $('#cNote').value,
    }) });
    toast('发布成功'); loadAll(); showView('discover'); openDetail(j.game.id);
  } catch (e) { toast(e.message); }
};

// ---------- 球友 ----------
function renderFriends() {
  $('#friendList').innerHTML = '';
  state.friends.forEach((f) => {
    const el = document.createElement('div');
    el.className = 'card friend-row';
    el.innerHTML = `<div><b>${f.nickname}</b> · ${f.relation}<br><span class="hint">${(f.sports || []).join(' · ')}</span></div>
      <div><button class="${f.invited ? 'invited' : ''}" data-a="invite">${f.invited ? '已邀请' : '约TA'}</button>
      <button data-a="remove">移除</button></div>`;
    el.querySelector('[data-a="invite"]').onclick = async () => {
      await api(`/api/friends/${f.id}/invite`, { method: 'POST', body: JSON.stringify({ userId: me.id, invited: !f.invited }) });
      loadAll();
    };
    el.querySelector('[data-a="remove"]').onclick = async () => {
      if (!confirm('确定移除这位球友吗？')) return;
      await api(`/api/friends/${f.id}`, { method: 'DELETE' }); loadAll();
    };
    $('#friendList').appendChild(el);
  });
}
$('#addFriendBtn').onclick = async () => {
  try {
    await api('/api/friends', { method: 'POST', body: JSON.stringify({ userId: me.id, nickname: $('#fNickname').value, relation: $('#fRelation').value, sports: [...friendSports] }) });
    $('#fNickname').value = ''; toast('已加为球友'); loadAll();
  } catch (e) { toast(e.message); }
};

// ---------- 消息 / 我的 ----------
// 收到的站内邀请：点“进入球局”打开局详情，报名后邀请自动消失
function renderInvites() {
  const list = state.invites || [];
  $('#inviteList').innerHTML = list.map((inv) =>
    `<div class="card" data-inv="${inv.id}"><h3>🏀 ${inv.fromNickname} 邀请你加入「${inv.game.title}」</h3><div class="meta">${inv.game.date} ${inv.game.timeLabel} · ${inv.game.venue} · ${inv.game.sport}<br>已报名 ${inv.game.joinedCount}/${inv.game.totalSpots} 人</div>
    <div style="margin-top:10px;display:flex;gap:8px;"><button class="primary" data-a="enter">进入球局</button><button data-a="dismiss">忽略</button></div></div>`).join('')
    || '<p class="hint">暂时没有人邀请你。</p>';
  document.querySelectorAll('#inviteList [data-inv]').forEach((el) => {
    const inv = list.find((x) => x.id === el.dataset.inv);
    el.querySelector('[data-a="enter"]').onclick = () => { showView('discover'); openDetail(inv.gameId); };
    el.querySelector('[data-a="dismiss"]').onclick = async () => {
      await api(`/api/invites/${inv.id}/dismiss`, { method: 'POST', body: JSON.stringify({ userId: me.id }) });
      loadAll();
    };
  });
}
function renderThreads() {
  $('#threadList').innerHTML = state.threads.map((t) =>
    `<div class="card game-card" data-g="${t.gameId}"><h3>${t.title}</h3><div class="meta">${t.lastMessage || '还没有消息'}</div></div>`).join('')
    || '<p class="hint">还没有加入任何局。</p>';
  document.querySelectorAll('#threadList .game-card').forEach((el) => el.onclick = () => openDetail(el.dataset.g));
}
function renderMyGames() {
  const mine = state.games.filter((g) => g.hostId === me.id || g.joinedByMe);
  $('#myGames').innerHTML = mine.map((g) =>
    `<div class="card game-card" data-g="${g.id}"><h3>${g.title}</h3><div class="meta">${g.date} ${g.timeLabel} · ${venueLink(g)}<br>已报名 ${g.joinedCount}/${g.totalSpots} 人${g.hostId === me.id ? ' · 我组织的' : ''}</div></div>`).join('')
    || '<p class="hint">你还没有参加任何局。</p>';
  document.querySelectorAll('#myGames .game-card').forEach((el) => el.onclick = () => openDetail(el.dataset.g));
}
$('#saveProfileBtn').onclick = async () => {
  try {
    await saveProfile({ id: me.id, nickname: $('#myNickname').value, city: $('#myCitySel').value, identity: $('#myIdentity').value, sports: [...mySports] });
    $('#myCity').textContent = me.city + ' · ' + me.nickname;
    toast('资料已保存'); loadAll();
  } catch (e) { toast(e.message); }
};

// ---------- 启动 ----------
if (me && me.id) enterApp(); else { renderSetupSports(); showSetup(); }
