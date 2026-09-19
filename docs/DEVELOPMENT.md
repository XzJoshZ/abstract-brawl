# 开发指南

项目是无运行依赖的静态网页。根目录 `index.html` 是模式选择页，三个模式分别由各自 HTML 按顺序加载传统脚本。部分对象通过 `window` 共享，因此调整脚本顺序前应检查依赖。

## 从哪里修改

| 目标 | 文件 |
| --- | --- |
| 首页与随机角色展示 | `index.html`、`lobby.js`、`lobby.css` |
| 格斗基本角色与历史覆盖 | `roster.js`、`meme-roster.js`、`roster-revision3.js` |
| 格斗规则、碰撞、2V2 | `engine.js`、`meme-combat.js` |
| 格斗技能道具与表现 | `meme-art.js`、`meme-visuals.js` |
| 格斗界面和输入 | `ui.js`、`style.css`、`touch-input.js`、`touch-guard.js` |
| 格斗局域网联机 | `net.js`（客户端协议）、`scripts/ws-relay.mjs`（房间中转）、`engine.js` 中 `mode==='net'` 分支 |
| 回合战规则、角色、招式 | `turn-engine.js`、`turn-data.js`、`turn-cast.js` |
| 回合战四格布阵 | `turn-formation.js` |
| 回合战画面与界面 | `turn-renderer.js`、`turn-ui.js`、`turn.css` |
| 自走棋费档、羁绊与招牌 | `chess-data.js` |
| 自走棋经济、AI、布阵与战斗 | `chess-engine.js` |
| 自走棋拖放、画面与界面 | `chess-placement.js`、`chess-renderer.js`、`chess-ui.js`、`chess.css` |
| 自走棋开始页与存档阵容展示 | `chess.html`、`start-screen.css`、`chess-ui.js` |
| 自走棋专用场景、透明格线 | `board-themes.js`、`chess-scenes/` |
| 自走棋角色动画资源加载 | `character-art.js` |
| 动作索引和播放 | `animations.js`、`animation-player.js` |
| 图片索引 | `assets.js`、`assets/`、`raster/` |
| 格斗与回合战场景 | `stages.js`、`stages/` |
| 格斗音乐 / 其他模式音乐 | `music.js` / `mode-music.js` |

## 角色和兼容性

角色使用稳定 ID。删除角色产生的空缺不应通过重新编号填补，召唤、借招、索引和旧存档会引用这些 ID。要乐奈含左右独立动作以保留异瞳等不对称细节，不要仅依靠水平镜像替换所有角色素材。

自走棋中费用与星级不同：费用决定购卡价格和基础属性；三张同名同星合成下一星。经济状态还包括所有商店预留卡、候补、在场棋子和共享池。修改费档后须更新历史池映射及迁移，不能直接按新池检查旧档。

`AbstractChess.LineupEvaluator` 同时计算真实战斗常驻属性与综合布阵的估值。只统计场上不同角色；同名角色常驻关系加成仅由最高星副本领取。不要在 UI 里另写一套不一致的羁绊规则。

`tests/context.cjs` 在 Node VM 中按游戏依赖顺序加载纯规则。测试覆盖技能资源上限、关系触发、同名共享、穷举布阵、缓存等价性、远程攻击和完整赛事卡池守恒。`tests/ui-fixture.cjs` 提供轻量 DOM 模拟，检查开始页、存档恢复、首轮结算、场景切换和布阵格子坐标；没有模拟真实手机 GPU、浏览器布局或触控手感。

自走棋使用 `abstract-autochess-run-v1` 保存赛事，开始页只读取未结束赛事中的玩家棋盘。旧场景 ID 不属于当前六种棋盘时回退为随机，角色和经济状态仍保留。新增自走棋场景应加入 `board-themes.js` 与 `chess-scenes/`，不要写入其他模式的 `stages.js`；打包脚本和图片检查已包含这个资源目录。

## 局域网联机

联机采用**延迟式确定性锁步**：两台机器各自完整运行 `engine.js` 的模拟，线上只传 10 位按键掩码，主机（1P）是时钟，访客落后 6 步。确定性来源是布尔输入、经 `go` 消息下发的种子 PRNG（`options.random`）与渲染随机数的 `fxRandom` 拆分；每 24 步双方计算 FNV-1a 状态哈希交叉核对。哈希浮点量化到 1e-4（`stateHash` 的 `canonical()`），吸收不同浏览器引擎在 `Math.exp/sin/cos` 上的最后一位尾数差异，且连续两次不一致才中止——这是跨浏览器可玩的关键容差。重连由主机快照兜底：`snapshot()/restore()` 序列化全部模拟状态（含 PRNG 状态与攻击对象共享关系），访客断线自动退避重连、整页刷新经 sessionStorage 续战，房间在双方全部离开前持续保留；中转按帧活跃度（ping/pong 刷新）在 12 秒无帧后接管死亡连接的槽位，避免半开连接挡住重连。访客机器的 1P 键位（WASD + J K U I O L）在引擎 `keyDown/keyUp` 入口按 `P1_TO_P2` 翻译到控制器 1。

- 改引擎规则时保持 `mode==='net'` 路径确定性：模拟内禁止使用 `Date.now`、未种子随机数或 Promise 续体直改模拟状态（mimic 借招在 net 模式同步执行正是为此）。
- `tests/net-sync.test.cjs` 用双实例锁步回归确定性；`tests/net-relay.test.cjs` 在 VM 里跑真实 `NetClient` + 真实中转，覆盖大厅、对局、掉线重连与快照续战。修改协议或引擎网络分支后必须保持两套测试全绿。
- 中转是手写 RFC 6455，在 `scripts/ws-relay.mjs`；对端消息表与重连状态机在 `net.js` 顶部 `NET` 与 `NetClient`。

## 本地和打包

`npm run dev` 监听所有网卡（供局域网联机），默认端口 3100，可用 `npm run dev -- --port 3200` 换端口，启动时打印局域网地址；同一进程内的 `/ws` 路径提供联机房间中转。`npm run play`（或双击 `start.bat`）是一键启动：自动打开浏览器、端口占用时顺延到 3101+、窗口输入 `stop` 回车手动关闭。自动退出依据**页面心跳**（每个页面每 15 秒请求 `/__ping`，见各 HTML 末尾的内联脚本；后台标签页被节流到约每分钟一次）：无任何连接且 90 秒无心跳才判定页面全部关闭——只凭 TCP 连接数会把空闲页面误判为已关闭（浏览器会自行断开闲置 keep-alive 连接）。`AB_NO_BROWSER=1` 可跳过自动开浏览器，`AB_IDLE_EXIT_MS` 覆盖退出阈值。`npm run relay` 只启动中转（默认 3101 端口），供 file:// 打开的页面经 `?relay=ws://主机IP:3101` 使用。静态服务器与中转的实现分别在 `scripts/static-server.mjs` 与 `scripts/ws-relay.mjs`。

`npm run build` 按明确的文件类型与运行资源目录生成 `dist/`，复制许可与素材说明。开发脚本、测试、Git 历史和环境文件不会进入网页包。`npm run pack` 在此基础上生成 ZIP 与校验文件；支持的文件大小和总包体须小于标准 ZIP 的 4 GiB 限制。

常用自走棋说明见 [DESIGN.md](DESIGN.md) 与 [BALANCE.md](BALANCE.md)。修改逻辑后，先运行已有测试；只有新行为需要时再扩充对应测试。
