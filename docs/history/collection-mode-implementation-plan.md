# 地图寻踪 · 专题模式实施计划

> 配套方案：[collection-mode-plan.md](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/docs/collection-mode-plan.md)
> 配套专题清单：[collection-list.md](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/docs/collection-list.md)
> 配套验收与测试：[collection-mode-acceptance.md](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/docs/collection-mode-acceptance.md)
> 本文聚焦：MVP 第一版详细实施步骤（阶段一），阶段二/三仅列大纲

---

## 一、总体策略

### 1.1 分阶段原则
- **阶段一（MVP）**：3-5 个专题 + solo easy/hard + 邮箱登录 + 勋章入库 + 排行榜骨架。**本文档重点**
- **阶段二**：补齐 100 个专题 + PK 专题 + 排行榜完整功能
- **阶段三**：勋章等级（铜银金钻）+ UGC + 付费 + 社交分享

### 1.2 分支策略
- 新建分支 `feature/collection-mode`，搭独立测试环境
- 所有改动在分支完成，测试通过后才合并到 main
- 合并前确保 PC 端和手机端现有功能无回归

### 1.3 技术选型（沿用现有栈）
| 层 | 技术 |
|---|---|
| 后端 | FastAPI + SQLAlchemy + MySQL（复用现有） |
| 前端 | React + TypeScript + Leaflet + Tailwind（复用现有） |
| 邮件 | SMTP（复用现有或用免费 SMTP） |
| 部署 | gunicorn + Nginx + scp（复用现有） |

---

## 二、MVP 范围明确

### 2.1 MVP 做什么
| 功能 | 说明 |
|---|---|
| 数据表 | 6 张新表（collections / collection_pois / medals / user_medals / medal_records / users）+ player_sessions 加 2 字段 |
| 后端接口 | 专题列表 / 专题详情 / 开始专题 / 结束单点 / 完成专题 / 邮箱登录 / 勋章墙 / 排行榜（单专题+总榜+勋章数） |
| 前端页面 | 首页四卡片 / 专题列表页 / 专题详情页（预告卡）/ Collection.tsx（串联单局）/ 专题结算页 / 勋章墙 / 邮箱登录弹窗 / 我的足迹（轻量） |
| 专题数据 | 先上 3-5 个 ★1-★2 的专题（五岳归来、六大古都、四大佛教名山、五大淡水湖、江南三大名楼） |
| 难度 | solo easy + solo hard（PK 留到阶段二） |
| 玩法增强 | A1 预告卡 / A2 默认起点+固定顺序 / B5 过渡动画 / C4 单点知识卡 / D1 各点用时柱状图 / E1 个人足迹轻量点亮 / E3 排行榜 |

### 2.2 MVP 不做什么
- PK 专题（阶段二）
- 100 个专题全量（阶段二，MVP 只上 3-5 个）
- 几何图形渲染（已移至点子池 IP-012）
- 积分系统（本期不做）
- 微信登录（后续再说）
- 断点续传（已移至点子池 IP-009）
- 单点超时（已移至点子池 IP-010）
- 道具系统、好友对比、社交分享等（已在点子池）

---

## 三、实施步骤（MVP）

### 阶段 0：分支与测试环境准备

**任务**：
1. 新建 git 分支 `feature/collection-mode`
2. 本地启动现有项目，确认 PC/手机端正常（作为回归基准）
3. 准备测试用 SMTP（如 QQ 邮箱授权码 / Mailgun 免费额度）

**产出**：分支可用，测试环境就绪

---

### 阶段 1：数据库迁移（后端）

**任务 1.1**：创建 6 张新表的迁移 SQL

文件：`backend/scripts/migrate_collection_mode.sql`

```sql
-- 1. collections 专题元数据
CREATE TABLE collections (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  code         VARCHAR(48)  NOT NULL UNIQUE COMMENT '如 wuyue',
  name         VARCHAR(64)  NOT NULL COMMENT '如 五岳归来',
  description  TEXT         NULL,
  icon         VARCHAR(255) NULL,
  cover_url    VARCHAR(255) NULL,
  geometry     VARCHAR(32)  NULL,
  difficulty_star TINYINT  NOT NULL DEFAULT 1,
  unlock_require   INT     NOT NULL DEFAULT 0,
  audit_status VARCHAR(16) NOT NULL DEFAULT 'pending',
  sort_order   INT          DEFAULT 0,
  enabled      TINYINT(1)   DEFAULT 1,
  created_at   DATETIME     NOT NULL,
  INDEX idx_enabled (enabled),
  INDEX idx_star (difficulty_star),
  INDEX idx_audit (audit_status)
);

-- 2. collection_pois 专题-POI 关联
CREATE TABLE collection_pois (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  collection_id BIGINT NOT NULL,
  poi_id        BIGINT NOT NULL,
  sort_order    INT    NOT NULL,
  created_at    DATETIME NOT NULL,
  UNIQUE KEY uk_col_poi (collection_id, poi_id),
  INDEX idx_collection (collection_id),
  INDEX idx_poi (poi_id)
);

-- 3. medals 勋章表
CREATE TABLE medals (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  collection_id BIGINT NOT NULL,
  difficulty    VARCHAR(10) NOT NULL,
  game_type     VARCHAR(10) NOT NULL,
  name          VARCHAR(64) NOT NULL,
  icon_url      VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL,
  UNIQUE KEY uk_col_diff_type (collection_id, difficulty, game_type),
  INDEX idx_collection (collection_id)
);

-- 4. user_medals 用户当前勋章
CREATE TABLE user_medals (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id       BIGINT NOT NULL,
  medal_id      BIGINT NOT NULL,
  total_time_sec INT NOT NULL,
  earned_at     DATETIME NOT NULL,
  updated_at    DATETIME NOT NULL,
  UNIQUE KEY uk_user_medal (user_id, medal_id),
  INDEX idx_user (user_id),
  INDEX idx_medal (medal_id)
);

-- 5. medal_records 勋章流水
CREATE TABLE medal_records (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id       BIGINT NOT NULL,
  medal_id      BIGINT NOT NULL,
  total_time_sec INT NOT NULL,
  point_times   JSON NULL,
  is_win        TINYINT(1) NOT NULL DEFAULT 1,
  earned_at     DATETIME NOT NULL,
  INDEX idx_user (user_id),
  INDEX idx_medal (medal_id),
  INDEX idx_earned (earned_at)
);

-- 6. users 用户表
CREATE TABLE users (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  email        VARCHAR(128) NOT NULL UNIQUE,
  nickname     VARCHAR(32)  NOT NULL UNIQUE,
  avatar_url   VARCHAR(255) NULL,
  total_medals INT          NOT NULL DEFAULT 0,
  is_admin      TINYINT(1)   NOT NULL DEFAULT 0,
  last_login_at DATETIME    NULL,
  created_at   DATETIME     NOT NULL,
  updated_at   DATETIME     NOT NULL,
  INDEX idx_total_medals (total_medals)
);

-- 7. player_sessions 加字段
ALTER TABLE player_sessions
  ADD COLUMN collection_id BIGINT NULL COMMENT '关联 collections.id，NULL=非专题',
  ADD COLUMN point_index INT NULL COMMENT '专题第几点，NULL=非专题',
  ADD INDEX idx_collection (collection_id);
```

**任务 1.2**：在 `backend/app/models.py` 新增对应 SQLAlchemy 模型

**任务 1.3**：执行迁移 SQL 到开发库，验证表结构

**验证**：`DESCRIBE collections;` 等 6 张表字段正确，`player_sessions` 多了 2 字段

---

### 阶段 2：后端模型与基础接口

**任务 2.1**：`backend/app/models.py` 新增 6 个模型类
- `Collection`、`CollectionPoi`、`Medal`、`UserMedal`、`MedalRecord`、`User`
- `PlayerSession` 模型加 `collection_id`、`point_index` 字段

**任务 2.2**：邮箱登录模块
- 文件：`backend/app/services/auth.py`（新建）
- 接口：
  - `POST /api/auth/send_code`：发验证码（SMTP），验证码存 Redis（key=`email_code:{email}`，5 分钟过期）
  - `POST /api/auth/login`：校验验证码，登录/注册合一（新用户自动创建）
  - `POST /api/auth/check_nickname`：校验昵称全局唯一（大小写敏感）
  - `GET /api/auth/me`：获取当前用户信息（JWT 解析）
- 昵称沿用：查 `player_sessions` 最近 30 天该 session_id 的 nickname
- JWT token：用 `HS256`，有效期 30 天

**任务 2.3**：专题元数据接口
- 文件：`backend/app/api/collection.py`（新建）
- 接口：
  - `GET /api/collection/list?star=&page=`：专题列表（按星级分组，含解锁状态）
  - `GET /api/collection/{code}`：专题详情（含预告卡信息：封面、描述、点位数、平均用时、完成率、星级）
- 解锁校验：`is_unlocked(user, collection)` 逻辑（未登录按 session_id 查 player_sessions）

**任务 2.4**：专题游戏流程接口
- `POST /api/collection/start`：开始专题，返回第 1 个点的单局信息（复用 game.py 的 start 逻辑，加 collection_id/point_index）
- `POST /api/collection/point_end`：单点结束，记录用时，返回是否还有下一点 + 下一点起点坐标
- `POST /api/collection/finish`：专题完成，发勋章（hard 才发），记录总用时到 user_medals（取最快），写 medal_records 流水

**任务 2.5**：勋章与排行榜接口
- `GET /api/medal/wall?user_id=`：勋章墙（按星级分组，未获得的灰色）
- `GET /api/collection/leaderboard?collection_id=&difficulty=&game_type=&limit=50`：单专题排行
- `GET /api/collection/leaderboard?scope=total&limit=100`：总榜
- `GET /api/collection/leaderboard?scope=medal_count&limit=100`：勋章数榜
- 排行榜缓存：Redis 存 Top N，每日 0 点刷新

**验证**：用 Postman/curl 测试每个接口，确认返回结构正确

---

### 阶段 3：前端骨架与首页改造

**任务 3.1**：抽取通用单局组件（C 方案）
- 新建 `frontend/src/game/useSingleGame.ts`（hook，抽取单局状态管理）
- 新建 `frontend/src/game/SingleGame.tsx`（组件，渲染单局地图+面板）
- 重构 `Game.tsx` 引用 `useSingleGame` + `<SingleGame>`
- 重构 `PKGame.tsx` 同上
- **回归测试**：PC 端和手机端的 solo/PK 单局功能完全不变

**任务 3.2**：首页改四卡片
- 文件：`frontend/src/pages/Home.tsx`
- 从 3 卡片改为 4 卡片：自由模式 / PK 模式 / 主题模式 / 专题模式
- PC 端 2×2 网格，移动端纵向堆叠
- 专题卡片显示：图标 + "100 个专题等你收集" + 已获勋章数（登录后）
- 右上角加"登录"小图标（未登录灰色）

**任务 3.3**：邮箱登录弹窗
- 新建 `frontend/src/components/AuthModal.tsx`
- 邮箱输入 → 验证码输入 → 昵称沿用/输入
- 昵称冲突时显示推荐昵称列表
- 登录成功后更新全局用户状态

**任务 3.4**：专题列表页
- 新建 `frontend/src/pages/CollectionList.tsx`
- 按星级分组展示，可折叠
- 每个专题卡片：封面 + 名称 + 星级 + 点位数 + 锁/解锁状态
- 点击已解锁专题 → 进入专题详情页

**任务 3.5**：专题详情页（预告卡）
- 新建 `frontend/src/pages/CollectionDetail.tsx`
- 展示：封面 + 3 行文化背景 + 难度数据（平均用时、完成率、星级）
- 两个按钮："点选模式（easy）" / "巡航模式（hard）"
- 点击 → 进入 Collection.tsx 开始专题

**验证**：首页四卡片正常，登录弹窗可用，专题列表可浏览

---

### 阶段 4：Collection.tsx 专题流程

**任务 4.1**：Collection.tsx 主框架
- 新建 `frontend/src/pages/Collection.tsx`
- 状态管理：`currentIndex`（当前第几点）、`totalTime`（累计用时）、`pointTimes`（各点用时数组）
- 引用 `useSingleGame` + `<SingleGame>` 渲染单局
- 单局结束后调用 `point_end`，更新进度

**任务 4.2**：单点结算页覆盖
- 单点结算时，Collection 拦截默认结算页
- 显示：`1/5 已收集` 进度条 + 单点用时 + C4 知识卡（`pois.description`）
- 按钮："前往下一点"（非"再来一局"）

**任务 4.3**：B5 过渡动画
- 点击"前往下一点"后触发 `flyTo()` 到下一点目标坐标
- 顶部进度条数字跳动（`1/5` → `2/5`）
- 动画期间禁用地图操作，提供"跳过"按钮
- 飞行结束 → 开始下一点单局

**任务 4.4**：专题结算页
- 最后一点完成后进入专题结算页
- 显示：总用时 + D1 各点用时柱状图（最慢标红、最快标绿）
- 若 hard 模式 + 已登录 → 显示获得的勋章
- 若 hard 模式 + 未登录 → 弹窗"绑定邮箱领取勋章"
- 若 easy 模式 → 提示"已解锁下一星级，巡航模式可获得勋章"
- 按钮："返回专题列表" / "再来一局"（从头开始）

**任务 4.5**：E1 个人足迹（轻量）
- 首页"我的足迹"入口
- 全屏地图，点亮玩家在所有专题中收集过的 POI（仅标记 + tooltip）
- 未登录显示登录引导

**验证**：完整走通 1 个专题（如五岳归来 5 个点），从开始到结算到勋章入库

---

### 阶段 5：勋章墙与排行榜

**任务 5.1**：勋章墙
- 新建 `frontend/src/pages/MedalWall.tsx`
- 按星级分组：★1-2 入门 / ★3-4 进阶 / ★5-6 精通 / ★7-8 大师
- 每枚勋章：图标（已获得彩色/未获得灰色）+ 专题名 + 难度 + 玩法 + 用时 + 获得日期
- 未登录显示登录引导

**任务 5.2**：排行榜页
- 新建 `frontend/src/pages/Leaderboard.tsx`
- 3 个 Tab：单专题排行 / 总榜 / 勋章数榜
- 单专题排行需选专题 + 难度 + 玩法
- Top N 列表：排名 + 昵称 + 用时 + 获得日期

**验证**：勋章墙显示正确，排行榜可查询

---

### 阶段 6：3-5 个专题数据录入

**任务 6.1**：准备 5 个专题的 POI 数据
- 确认以下 POI 已在 `pois` 表中（若缺则补录）：
  - 五岳归来：泰山、华山、衡山（湖南）、嵩山、恒山（山西）
  - 六大古都：北京、西安、洛阳、开封、南京、杭州
  - 四大佛教名山：五台山、峨眉山、普陀山、九华山
  - 五大淡水湖：鄱阳湖、洞庭湖、太湖、洪泽湖、巢湖
  - 江南三大名楼：黄鹤楼、岳阳楼、滕王阁

**任务 6.2**：写入 collections + collection_pois 数据
- SQL 脚本：`backend/scripts/seed_collections_mvp.sql`
- 每个专题：1 条 collections + N 条 collection_pois
- 每个专题的每个难度×玩法：4 条 medals 记录（easy-solo / hard-solo / easy-pk / hard-pk）
- `difficulty_star` 标定：五岳=2、六大古都=2、四大佛教名山=2、五大淡水湖=1、江南三大名楼=1
- `audit_status = 'approved'`

**任务 6.3**：为每个 POI 补充 `description` 字段（C4 知识卡内容）
- 如泰山："泰山海拔 1545m，被尊为五岳之首"

**验证**：专题列表显示 5 个专题，可进入详情页查看预告卡

---

### 阶段 7：联调与端到端测试

**任务 7.1**：本地联调
- 前后端联调所有接口
- 走通完整流程：选专题 → 5 个点 → 结算 → 勋章 → 勋章墙 → 排行榜

**任务 7.2**：PC 端回归测试
- 自由模式、PK 模式、主题模式功能完全不变
- 手机端布局正常

**任务 7.3**：手机端适配
- 首页四卡片移动端纵向堆叠
- 专题列表移动端可滚动
- Collection.tsx 单局结算页移动端不遮挡
- 勋章墙移动端网格自适应

**任务 7.4**：边界测试
- 未登录玩家完成专题 → 无勋章
- 登录玩家完成 easy → 不发勋章但解锁下一星级
- 登录玩家完成 hard → 发勋章
- 重复完成 → 刷新最快用时
- 昵称冲突 → 推荐昵称

**任务 7.5**：执行验收清单
- 对照 [collection-mode-acceptance.md](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/docs/collection-mode-acceptance.md) 逐项验收

---

### 阶段 8：部署上线

**任务 8.1**：合并分支
- `feature/collection-mode` 合并到 `main`
- 解决冲突（若有）

**任务 8.2**：服务器数据库迁移
```bash
scp -P 11470 backend/scripts/migrate_collection_mode.sql root@36.133.232.51:/www/wwwroot/zhizhang/map/backend/scripts/
ssh -p 11470 root@36.133.232.51 "mysql -u joy_word -p<密码> map_game < /www/wwwroot/zhizhang/map/backend/scripts/migrate_collection_mode.sql"
```

**任务 8.3**：上传后端代码
```bash
scp -P 11470 backend/app/models.py backend/app/api/collection.py backend/app/services/auth.py backend/app/services/collection_service.py \
  root@36.133.232.51:/www/wwwroot/zhizhang/map/backend/app/对应目录/
```

**任务 8.4**：上传专题种子数据
```bash
scp -P 11470 backend/scripts/seed_collections_mvp.sql root@36.133.232.51:/www/wwwroot/zhizhang/map/backend/scripts/
ssh -p 11470 root@36.133.232.51 "mysql -u joy_word -p<密码> map_game < /www/wwwroot/zhizhang/map/backend/scripts/seed_collections_mvp.sql"
```

**任务 8.5**：构建并上传前端
```bash
cd frontend && pnpm build
scp -P 11470 -r dist/* root@36.133.232.51:/www/wwwroot/zhizhang/map/frontend/dist/
```

**任务 8.6**：重启后端
```bash
ssh -p 11470 root@36.133.232.51 "ps aux | grep gunicorn | grep -v grep | awk '{print \$2}' | head -1 | xargs kill -HUP"
```

**任务 8.7**：线上冒烟测试
- 访问 https://word.zhizhang.me 确认首页四卡片
- 选一个专题完整走通
- 登录领勋章

---

## 四、阶段二大纲（100 个专题 + PK）

### 4.1 补齐 100 个专题
- 用 AI 生成剩余 95 个专题的 POI 列表
- 开发者审核标定星级（`audit_status = approved`）
- 批量写入 collections + collection_pois + medals

### 4.2 PK 专题
- 后端：PK 房间支持 `collection_id` 参数
- 前端：PK 房间创建时选专题
- F1 同步起跑 + F2 对手进度可见
- 方案 B 流程：赢家等待/离开 + 输家继续/放弃

### 4.3 排行榜完整
- 后台排行榜管理页（剔除作弊、手动刷新缓存）
- 单专题排行 + 总榜 + 勋章数榜全部可用

---

## 五、阶段三大纲（勋章等级 + UGC + 付费）

- 勋章等级：铜银金钻（基于完成的难度组合）
- UGC 专题：玩家自建专题（依赖 IP-026 复活）
- 付费专题包（依赖 IP-025 复活）
- 社交分享（依赖 IP-027 复活）

---

## 六、风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| C 方案重构导致 Game/PKGame 回归 | 高 | 分支开发 + 完整回归测试，不通过不合并 |
| 邮件 SMTP 被限流 | 中 | 用 QQ 企业邮箱或 Mailgun，限制每日发送量 |
| 5 个专题 POI 数据缺失 | 中 | 阶段 6.1 提前检查，缺的补录 |
| 手机端 Collection 结算页遮挡 | 中 | 复用之前手机端 sheet 方案，PC/移动端分离 |
| 排行榜缓存与实时性冲突 | 低 | MVP 先不缓存实时查，数据量大再加 Redis |

---

## 七、交付物清单

### MVP 交付
- [ ] 6 张新表 + player_sessions 2 字段迁移
- [ ] 后端：models.py + auth.py + collection.py + collection_service.py
- [ ] 前端：useSingleGame.ts + SingleGame.tsx + Collection.tsx + CollectionList.tsx + CollectionDetail.tsx + MedalWall.tsx + Leaderboard.tsx + AuthModal.tsx
- [ ] Home.tsx 改四卡片
- [ ] Game.tsx / PKGame.tsx 重构引用通用组件
- [ ] 5 个专题种子数据
- [ ] 线上部署完成

### 验收文档
- [collection-mode-acceptance.md](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/docs/collection-mode-acceptance.md)

---

## 八、执行顺序总览

```
阶段0 分支准备
  ↓
阶段1 数据库迁移
  ↓
阶段2 后端模型与接口
  ↓
阶段3 前端骨架（含 Game/PKGame 重构）
  ↓
阶段4 Collection.tsx 专题流程
  ↓
阶段5 勋章墙与排行榜
  ↓
阶段6 录入 5 个专题数据
  ↓
阶段7 联调与测试
  ↓
阶段8 部署上线
```
