# 约球运动 App —— 多人共用网页版

邀请朋友、同学一起打球、做运动。**一个共享后端 + 一个共享数据库**：任何人在网页上建局、报名、邀人、发消息，所有人立刻都能看到。打开就是空的，没有任何预置的假人、假局。

## 功能

- **登录**：昵称 + 城市 + 常玩运动，无密码、无手机验证（朋友小范围试用）。资料保存在后端。
- **发现**：按城市筛选、搜索标题/场馆、按运动筛选，局卡片显示剩余名额和报名进度。
- **局详情**：成员名单（只显示真实报名的人）、报名 / 取消报名、局内群聊。
- **发起约球**：标题、运动、日期、时间、场馆、城市、总人数、费用、水平、备注，发布后所有人可见，组织者自动算作已报名。
- **球友**：自己加朋友/同学（昵称、关系、运动），可约TA（邀请开关）、可移除。名单默认是空的。
- **消息**：只显示你参加或组织的局的群聊。
- **我的**：改资料、看我参加和组织的局。

## 本地运行

要求：Node.js 18 以上（已在 Node v24 上测试通过）。**零第三方依赖，不用 `npm install` 也可以直接跑。**

```bash
cd yueqiu-app
npm start
# 看到「约球 App 已启动：http://localhost:3000」后，用浏览器打开
# http://localhost:3000
```

- 端口：默认 `3000`，用环境变量改：`PORT=8080 npm start`
- 数据：存在项目里的 `data.json`（JSON 文件数据库，启动时不存在会自动创建为空）。备份/迁移时直接复制这个文件即可。不要把真实用户数据提交到公开仓库。
- 停止：Ctrl+C。

## API 接口

基础地址：`http://localhost:3000`

| 方法 | 接口 | 说明 |
|---|---|---|
| POST | `/api/profile` | 创建/更新资料。body：`{id?（更新时传）, nickname*, city*, identity?, sports*[]}`，运动取自：篮球、羽毛球、足球、网球、跑步、乒乓球、瑜伽、其他 |
| GET | `/api/profile?userId=` | 取一位用户的资料 |
| GET | `/api/state?userId=` | 一次取回全部局、我的球友、我的群聊摘要 |
| GET | `/api/games?userId=&city=&sport=&q=` | 局列表（可按城市、运动、关键词过滤） |
| POST | `/api/games` | 建局。body：`{userId*, title*, sport*, date*（YYYY-MM-DD）, timeLabel*, venue*, city?, district?, totalSpots*（2-100）, feeText?, level?, note?}` |
| GET | `/api/games/:id?userId=` | 一局的详情，含真实成员名单 |
| POST | `/api/games/:id/join` | 报名。body：`{userId*}`；满员会报错；组织者自动已报名 |
| POST | `/api/games/:id/leave` | 取消报名（组织者不能取消） |
| GET | `/api/friends?userId=` | 我的球友列表 |
| POST | `/api/friends` | 加球友。body：`{userId*, nickname*, relation?, sports?[]}` |
| POST | `/api/friends/:id/invite` | 约TA开关。body：`{userId, invited}` |
| DELETE | `/api/friends/:id` | 移除球友 |
| GET | `/api/games/:id/messages` | 一局的群聊消息 |
| POST | `/api/games/:id/messages` | 发消息。body：`{userId*, text*}`；只有本局成员能发言 |
| GET | `/health` | 健康检查 |

所有接口返回 `{ok: true, ...}` 或 `{ok: false, error: "中文原因"}`。

## 部署给朋友试用（推荐路线：Railway，免费额度可用）

> 为什么选 Railway：不用自己买服务器、不用配域名解析，推代码就能上线，带持久化磁盘放 `data.json`；比纯静态托管多一个 Node 后端，才能真正多人共用数据。

**准备**：一个 GitHub 账号、一个 Railway 账号（用 GitHub 登录即可）。

1. 把 `yueqiu-app/` 推到你自己的 GitHub 仓库（新建空仓库，按 GitHub 给的命令推上去即可）。
2. 打开 [railway.app](https://railway.app) → New Project → Deploy from GitHub repo → 选这个仓库。
3. Railway 会自动识别 `package.json` 里的 `npm start` 并启动。等部署变绿。
4. **关键一步——持久化数据**：在 Railway 项目里给这个服务加一个 Volume，挂载到 `/app/data`，并把服务变量 `DB_FILE` 设为 `/app/data/data.json`（见下方说明：默认写在项目根目录的 `data.json`；挂 Volume 后改路径，重启后数据才不会丢）。如果暂时不加 Volume 也能用，但服务重启后数据会清空。
   > 注意：`server.js` 已支持用环境变量 `DB_FILE` 指定数据文件路径（默认是项目内的 `data.json`），所以上面把变量设为 `/app/data/data.json` 即可，不用改代码。
5. 在 Railway 里点服务 → Settings → Networking → Generate Domain，得到一个 `https://xxx.up.railway.app` 的公开链接。
6. 把这个链接发到朋友群里：大家打开先填昵称、城市、运动，就能一起建局、报名、聊天。所有人的数据都在同一个 `data.json` 里。

**备选路线**：

- **Render（免费版）**：同样从 GitHub 部署 Web Service，启动命令 `npm start`；免费版会休眠，首次打开要等几十秒唤醒；持久化磁盘需要付费档，不加的话重启会丢数据。
- **自己有 VPS（比如阿里云/腾讯云轻量服务器）**：装 Node 18+，把代码传上去，`npm start` 后用 `pm2` 守护（`npm i -g pm2 && pm2 start server.js --name yueqiu && pm2 save`），再用 Nginx 反向代理到 3000 端口并配域名 + HTTPS。这是长期运营最稳的路子，但要自己管服务器和备份。

**还不是正式上架**：这是网页版，不是 App Store 的 App、也不是微信小程序。朋友用浏览器打开链接就能用；iPhone 上也可以点分享 →「添加到主屏幕」，看起来就像一个 App。真要上架 App Store 或做小程序，需要另外的开发者账号和审核流程。

## 数据与隐私

- 没有假数据：数据库启动时是空的，只有大家真实提交的昵称、局、报名和消息。
- 没有密码和手机号：目前只靠昵称区分人，适合朋友小范围试用；对外公开前请加上登录验证和管理员功能。
- 备份：定期复制服务器上的 `data.json` 即可恢复全部数据。
