# 地图寻踪 · 专题模式（Collection）方案

> 状态：方案文档（不改代码，待讨论）
> 范围：新增"专题模式"玩法、勋章系统、专题排行榜、邮箱登录引导与奖励
> 配套文档：专题清单见 [collection-list.md](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/docs/collection-list.md)
> 现状参考：`poi-themes-plan.md`（主题 mode=theme）、`points-system-plan.md`（邮箱登录已规划）、`admin-and-ugc-plan.md`（player_sessions 已采集）、`backend/app/services/game.py` 的 `MODE_CONFIG`（当前仅 national/provincial/city）

---

## 一、背景与目标

### 1.1 现状
- 当前有三种模式：全国（national）、省市（provincial/city）、主题（theme）
- 所有模式都是"一局猜一个点"，玩完即止，缺少长期目标与收集感
- `points-system-plan.md` 已规划邮箱登录但未落地，缺少"非登录不可"的强转化场景
- `poi-themes-plan.md` 的主题池已覆盖大量 POI，但单点玩法难以体现"系列感"

### 1.2 专题模式是什么
**专题模式 = 一局内按顺序收集多个关联地点（3~8 个），集齐获得勋章，总用时计入排行榜。**

与主题模式（theme）的本质区别：
| 维度 | 主题模式（theme） | 专题模式（collection） |
|---|---|---|
| 目标数 | 1 个 POI | 3~8 个 POI 按序 |
| 完成标识 | 单局胜负 | 勋章（永久） |
| 排名维度 | 单局胜负 | 专题总用时 |
| 复玩动力 | 换个 POI 再玩 | 集齐 100 个勋章 |
| 登录触发 | 不强制 | **完成后必须登录领勋章** |

### 1.3 设计目标
1. **收集驱动**：100 个专题给玩家明确的"集齐目标"，延长生命周期
2. **几何浪漫**：部分专题的点连起来能构成爱心、五角星等图形，增加传播点
3. **登录转化**：用"领勋章"作为邮箱登录的最强钩子
4. **社交传播**：勋章墙可分享，形成"我集齐了五岳"的炫耀感
5. **复用现有架构**：POI 表、player_sessions、gunicorn 部署均不破坏

---

## 二、核心玩法

### 2.1 一局专题的完整流程

```
选专题 → 选难度（点选 easy / 巡航 hard）→ 选模式（单人 / PK）
   ↓
进入第 1 个点（与现有 solo/PK 完全一致：定位、判定、结算）
   ↓
结算页显示"1/5 已收集"，自动进入第 2 个点（起点 = 上一点目标）
   ↓
... 直到第 N 个点完成
   ↓
专题结算页：总用时、各点用时、获得的勋章
   ↓
[未登录] 强制弹窗"绑定邮箱领取勋章" → [已登录] 勋章直接入库
```

### 2.2 实现决策（已决定）

| 项 | 决定 |
|---|---|
| 首页布局 | 4 卡片（自由/PK/主题/专题），PC 端 2×2 网格，移动端纵向堆叠；专题卡片显示图标 + "100 个专题等你收集" + 已获勋章数（登录后） |
| PK 专题 | solo 搞定后 PK 自然搞定，不单独设计 PK 房间协议 |
| 后端接口 | **不复用** `/api/game/start`，重新写专题专用接口 |
| 勋章图资源 | 到做专题时再说，大概率用 trae worker 生成 |
| 几何图形渲染 | 往后放（已移至 [idea-pool.md](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/docs/idea-pool.md) IP-012） |
| 离线模式 | **不做**，本系统依赖在线地图瓦片，无法离线 |
| Collection.tsx 实现 | **C 方案**：抽取 `useSingleGame` hook + `<SingleGame>` 组件，Game/PKGame/Collection 三者引用。切分支搭测试环境，测试完毕才合并 |
| 星级解锁 | ★1 默认全开放；**完成任意一种模式（easy/hard × solo/pk）算通关**（用于解锁下一星级）；1-8 星和解锁逻辑按 §4.8 现状 |
| 勋章规则 | **巡航模式（hard）给勋章，点选模式（easy）只解锁下一星级但不发勋章** |
| 排行榜冷启动 | 先留空，需要加数据再说 |
| 专题更新频率 | 后续再说，先不讨论 |
| 专题难度标记 | 正文 §4.8 已详细表达 |
| 作弊检测 | 短期不考虑，即便开着高德地图玩也不干涉 |

### 2.3 流程中可丰富的玩法空间

当前 MVP 流程是"多个单局串联 + 总计时"。以下是本期确认要做的玩法增强：

#### A. 开局前

| 建议 | 说明 |
|---|---|
| A1. 专题预告卡 ✅ MVP | 选专题时展示一张卡片：封面 + 3 行文化背景（如"五岳是中国五大名山，历代帝王祭祀之所"）+ 难度数据（平均用时、平均完成率、星级） |
| A2. 起点与点位顺序 ✅ MVP | **默认起点 + 固定顺序**：第 1 个点为专题默认起点，后续按 `poi_order` 固定顺序解锁。（自选顺序、续玩等可能性已移至 [idea-pool.md](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/docs/idea-pool.md) IP-013） |

#### B. 收集过程中

**B5. 过渡动画** ✅ MVP — 详细设计：

| 环节 | 设计 |
|---|---|
| 触发时机 | 单点结算页点击"前往下一点"按钮后触发 |
| 动画内容 | 地图从当前点 flyTo 到下一个点目标坐标，时长 2-3 秒，easeLinearity 0.25 |
| 进度条 | 顶部进度条从 `1/5` 滚动到 `2/5`，带数字跳动动画 |
| 用户交互 | 动画期间禁用地图操作（拖拽/缩放/点击），完成后恢复 |
| 跳过 | 提供"跳过动画"按钮，点击后直接到达下一局起点 |
| 最后一点 | 最后一点完成后不触发飞行，直接进入专题结算页 |
| 音效 | 飞行开始播放"whoosh"音效（可被音效开关控制） |
| 实现方式 | 复用 Leaflet `flyTo()`，进度条用 CSS transition + React state |

#### C. 单点结算页

| 建议 | 说明 |
|---|---|
| C4. 单点知识卡 ✅ MVP | 单点结算时展示该 POI 的一句话冷知识（如"泰山海拔 1545m，被尊为五岳之首"），知识内容存 `pois.description` 字段 |

#### D. 专题结算页

| 建议 | 说明 |
|---|---|
| D1. 各点用时柱状图 ✅ MVP | 用柱状图展示专题各点用时，最慢的点标红，最快的标绿 |

#### E. 跨专题 / 长期

| 建议 | 说明 |
|---|---|
| E1. 个人专题地图 ✅ MVP（轻量） | 首页"我的足迹"轻量点亮玩家在所有专题中收集过的 POI（仅标记位置 + tooltip，不做复杂交互。复杂交互如"加入到游戏本身"已移至 [idea-pool.md](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/docs/idea-pool.md) IP-021） |
| E3. 专题排名 ✅ MVP | 见下方详细说明 |

#### F. PK 专题专属

| 建议 | 说明 |
|---|---|
| F1. 同步起跑 ✅ MVP | 两人同时开始第 1 点，各自进度，先集齐者胜 |
| F2. 对手进度可见 ✅ MVP | 显示对手"已完成 3/5"的进度条 |

**E3 专题排名详细说明**：

| 维度 | 说明 | 前端入口 | 后端接口 |
|---|---|---|---|
| **单专题排行** | 单一专题 + 难度 + 玩法下的 Top N 用时 | 专题详情页"排行榜"Tab | `GET /api/collection/leaderboard?collection_id=&difficulty=&game_type=&limit=50` |
| **总榜** | 所有专题总用时全站 Top 100 | 排行榜页"总榜"Tab | `GET /api/collection/leaderboard?scope=total&limit=100` |
| **勋章数榜** | 勋章总数全站 Top 100 | 排行榜页"勋章数"Tab | `GET /api/collection/leaderboard?scope=medal_count&limit=100` |

- **后台管理**：
  - 后台"排行榜管理"页可查看各维度 Top 100
  - 支持按专题筛选
  - 支持手动剔除作弊记录（标记 `is_cheater` 不入榜）
  - 排行榜缓存每日 0 点刷新（避免高频查询），后台可手动触发刷新
- **入榜规则**：
  - 必须登录才能上榜（匿名玩家即使完成也不入榜，但可保留进度）
  - 同一专题同模式只取最快用时（UNIQUE 约束 + ON DUPLICATE UPDATE 取更小值）

### 2.4 首页布局

首页从 3 卡片改为 **4 卡片**：自由模式 / PK 模式 / 主题模式 / 专题模式。排版需优化，4 张卡片在 PC 端可 2×2 网格或 1×4 横排，移动端纵向堆叠。专题模式卡片显示：专题图标 + "100 个专题等你收集" + 已获勋章数（登录后）。

### 2.5 关键规则

| 规则 | 说明 |
|---|---|
| 顺序收集 | 专题内点位**按固定顺序**解锁，不可跳点（第 1 个点为专题默认起点，详见 §2.3-A2）|
| 起点继承 | 第 N+1 点的起点 = 第 N 点的目标坐标（与现有 solo/PK 机制一致） |
| 中途放弃 | 已完成的点不计入进度，下次重玩该专题时**从头开始**（本期不设放弃惩罚） |
| 单点超时 | 本期不设置单点超时（单点超时机制已移至 [idea-pool.md](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/docs/idea-pool.md)）|
| PK 专题 | 房间内两人同步收集同一专题，**先集齐者胜**；赢家集齐后弹窗"等待对手 / 离开"，输家弹窗"继续完成（solo 模式）/ 放弃"；无论胜利还是失败完成都能获得与 solo 相同的勋章；两人都点"再来一局"才重新匹配 |
| 重玩刷新 | 已获勋章后重玩更快用时，**刷新排行榜**（取最快用时），鼓励多玩；不重复发勋章奖励 |
| 专题难度 | 专题难度按**综合难度**判定（非单点难度叠加），由后台统一配置 `difficulty_star`（1-8 星），支持后台修改；新增/修改专题难度需经**难度审核**流程 |

### 2.4 与现有模式的关系
- 专题模式**复用**现有的 solo/PK 单局逻辑（`services/game.py`、`services/pk.py`）
- 每个点本质就是一局 `mode=national + category=<专题 category>` 的单局
- 专题层只负责"串联多局 + 记录总用时 + 发勋章"
- 前端 Game.tsx / PKGame.tsx **不改**，新增 `Collection.tsx` 作为专题外壳，内部调用现有单局组件

---

## 三、专题清单

详见独立文档：[collection-list.md](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/docs/collection-list.md)

- 共 100 个专题，分 13 个类别（山岳朝圣 / 江河湖海 / 古都名城 / 世界遗产 / 建筑奇迹 / 交通工程 / 人文教育 / 红色记忆 / 民族风情 / 美食地理 / 影视取景 / 科学坐标 / 几何图形）
- 点数控制在 3~8 个
- 14 个专题标注「★」可构成几何图形（五角星 / 爱心 / 八角星 / 中国版图等）
- 覆盖 POI 总数约 470 个（全部复用现有 POI 表）
- 星级分布建议（1-8 星）见 collection-list.md 末尾

---

## 四、数据模型

### 4.1 新增表：`collections`（专题元数据）

```sql
CREATE TABLE collections (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  code         VARCHAR(48)  NOT NULL UNIQUE COMMENT '如 wuyue',
  name         VARCHAR(64)  NOT NULL COMMENT '如 五岳归来',
  description  TEXT         NULL,
  icon         VARCHAR(255) NULL COMMENT '专题图标 URL',
  cover_url    VARCHAR(255) NULL COMMENT '专题封面图',
  geometry     VARCHAR(32)  NULL COMMENT '几何图形标识：heart/star/...',
  difficulty_star TINYINT  NOT NULL DEFAULT 1 COMMENT '专题难度星级 1-8（1最易，8最难）',
  unlock_require   INT     NOT NULL DEFAULT 0 COMMENT '解锁本星级所需已完成的前一星级专题数',
  audit_status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT '审核状态：pending/approved（AI 生成默认 pending，开发者审核后 approved）',
  sort_order   INT          DEFAULT 0,
  enabled      TINYINT(1)   DEFAULT 1,
  created_at   DATETIME     NOT NULL,
  INDEX idx_enabled (enabled),
  INDEX idx_star (difficulty_star),
  INDEX idx_audit (audit_status)
);
```

### 4.2 新增表：`collection_pois`（专题-POI 关联表）

```sql
CREATE TABLE collection_pois (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  collection_id BIGINT NOT NULL COMMENT '关联 collections.id',
  poi_id        BIGINT NOT NULL COMMENT '关联 pois.id',
  sort_order    INT    NOT NULL COMMENT '收集顺序（0=起点，1=第2点...）',
  created_at    DATETIME NOT NULL,
  UNIQUE KEY uk_col_poi (collection_id, poi_id),
  INDEX idx_collection (collection_id),
  INDEX idx_poi (poi_id)
);
```
说明：用关联表替代 JSON `poi_order`，便于后续扩展（如单点难度、线索文案等字段）。查询时 `ORDER BY sort_order` 获取收集顺序。

### 4.3 新增表：`medals`（勋章表）

```sql
CREATE TABLE medals (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  collection_id BIGINT NOT NULL COMMENT '关联 collections.id',
  difficulty    VARCHAR(10) NOT NULL COMMENT 'easy/hard',
  game_type     VARCHAR(10) NOT NULL COMMENT 'solo/pk',
  name          VARCHAR(64) NOT NULL COMMENT '勋章名（如：五岳归来·困难·单人）',
  icon_url      VARCHAR(255) NULL COMMENT '勋章图标 URL',
  created_at    DATETIME NOT NULL,
  UNIQUE KEY uk_col_diff_type (collection_id, difficulty, game_type),
  INDEX idx_collection (collection_id)
);
```
说明：勋章是静态数据（一个专题 × 难度 × 玩法 = 一枚勋章），与用户无关。

### 4.4 新增表：`user_medals`（用户当前勋章）

```sql
CREATE TABLE user_medals (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id       BIGINT NOT NULL COMMENT '关联 users.id',
  medal_id      BIGINT NOT NULL COMMENT '关联 medals.id',
  total_time_sec INT NOT NULL COMMENT '当前最快用时',
  earned_at     DATETIME NOT NULL COMMENT '首次获得时间',
  updated_at    DATETIME NOT NULL COMMENT '最近刷新时间',
  UNIQUE KEY uk_user_medal (user_id, medal_id),
  INDEX idx_user (user_id),
  INDEX idx_medal (medal_id)
);
```
说明：用户当前持有的勋章，只保留**最快用时**（UNIQUE 约束 + ON DUPLICATE UPDATE 取更小值）。

### 4.5 新增表：`medal_records`（勋章记录流水）

```sql
CREATE TABLE medal_records (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id       BIGINT NOT NULL,
  medal_id      BIGINT NOT NULL,
  total_time_sec INT NOT NULL COMMENT '本次专题总用时',
  point_times   JSON NULL COMMENT '各点用时数组',
  is_win        TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'PK 模式是否胜利（1胜/0败，solo 恒为1）',
  earned_at     DATETIME NOT NULL,
  INDEX idx_user (user_id),
  INDEX idx_medal (medal_id),
  INDEX idx_earned (earned_at)
);
```
说明：每次获得/刷新勋章记一条流水。用于历史查询、统计、复盘。

### 4.6 新增表：`users`（用户表）

> `points-system-plan.md` 已规划邮箱登录但未落地，本方案首次落地需要完整字段。

```sql
CREATE TABLE users (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  email        VARCHAR(128) NOT NULL UNIQUE COMMENT '邮箱（登录凭证）',
  nickname     VARCHAR(32)  NOT NULL UNIQUE COMMENT '全局唯一昵称，与 PK 昵称打通，大小写敏感（如哈哈A与哈哈a是两个用户）',
  avatar_url   VARCHAR(255) NULL,
  total_medals INT          NOT NULL DEFAULT 0 COMMENT '勋章总数（冗余字段，便于排行榜）',
  is_admin      TINYINT(1)   NOT NULL DEFAULT 0,
  last_login_at DATETIME    NULL,
  created_at   DATETIME     NOT NULL,
  updated_at   DATETIME     NOT NULL,
  INDEX idx_total_medals (total_medals)
);
```

字段说明：
- `email`：邮箱登录凭证，全局唯一
- `nickname`：全局唯一（已有 `unique=True` 约束），与 PK 模式的 `player_sessions.nickname` 打通（详见 §7.3）
- `total_medals`：勋章总数冗余字段，避免排行榜实时 count

### 4.7 复用现有表
- `pois`：完全复用，不需新增字段（`category` 字段可填专题 code，便于管理后台筛选）
- `player_sessions`：每完成一个点记一条，新增字段 `collection_id`（BIGINT NULL，关联 collections.id，NULL 表示非专题对局）、`point_index`（INT NULL，标记属于专题的第几点，NULL 表示非专题）；`nickname` 字段与 `users.nickname` 打通

### 4.8 专题难度与解锁机制

**设计思路**：专题本身分 1-8 星难度，**不是线性的关卡制**（没有"第 1 关→第 2 关"固定顺序），而是"同星级内任选完成 N 个即可解锁下一星级"。玩家在已解锁星级内自由选专题，鼓励探索而非线性推进。

#### 4.8.1 星级配置（建议默认）

| 星级 | 定位 | 解锁条件（已完成本星级专题数） | 奖励倍率 |
|---|---|---|---|
| ★1 | 新手友好（3-4 点、地理常识） | 默认开放 | 1.0x |
| ★2 | 进阶（4-5 点、跨省） | 完成 2 个 ★1 | 1.2x |
| ★3 | 中级（5 点、边缘地理） | 完成 3 个 ★2 | 1.5x |
| ★4 | 中高级（5-6 点、冷门 POI） | 完成 3 个 ★3 | 1.8x |
| ★5 | 高级（6 点、几何图形） | 完成 4 个 ★4 | 2.0x |
| ★6 | 挑战（6-7 点、长距离连线） | 完成 4 个 ★5 | 2.5x |
| ★7 | 困难（7-8 点、冷门+几何） | 完成 5 个 ★6 | 3.0x |
| ★8 | 终极（8 点、中国版图/八卦方位） | 完成 5 个 ★7 | 5.0x |

说明：
- "完成"= 完成任意一种模式（easy/hard × solo/pk 任一即可，降低门槛；但只有 hard 模式给勋章，easy 只解锁不发勋章）
- 解锁条件存在 `collections.unlock_require` 字段，可后台调整
- 管理后台可为每个星级单独配置 `unlock_require`，不强制全站统一

#### 4.8.6 难度审核机制

专题由 AI 生成，生成后状态为 `pending`（待审核），开发者本人在后台审核确认后才能上架（`approved`）。审核时根据点位数、地理跨度、点位知名度综合判定星级 `difficulty_star`。

| 环节 | 说明 |
|---|---|
| **AI 生成** | 专题由 AI 生成，默认 `audit_status = pending` |
| **开发者审核** | 开发者本人在后台审核，确认点位与星级后设为 `approved` 上架 |
| **修改限制** | 已上线专题修改难度需重新审核；已有玩家完成记录的专题修改难度会重置该专题排行榜（需二次确认） |

#### 4.8.2 解锁校验逻辑（伪代码）

```python
def is_unlocked(user, collection):
    star = collection.difficulty_star
    if star == 1:
        return True  # ★1 默认开放
    # 统计用户在 star-1 星级已获得勋章的不重复专题数
    completed = db.query(
        func.count(distinct(UserMedal.collection_id))
    ).join(Collection).filter(
        UserMedal.user_id == user.id,
        Collection.difficulty_star == star - 1,
    ).scalar()
    require = collection.unlock_require or DEFAULT_REQUIRE[star]
    return completed >= require
```

#### 4.8.3 前端展示

- 专题列表页按星级分组（★1 / ★2 / ... / ★8），可折叠
- 已解锁星级正常显示专题卡片，未解锁星级显示锁图标 + "完成 N 个 ★X 解锁"
- 每个星级旁显示进度：`已完成 3/5（解锁 ★X+1 需 5 个）`
- ★1 始终开放，无锁

#### 4.8.4 边界情况
- **未登录玩家**：按 session_id 记录已完成专题数（存 Redis 或 `player_sessions` 聚合查询），登录后合并到 user_id
- **跨星级跳级**：不允许跳级解锁，必须逐级满足
- **重玩同一专题**：只算 1 个已完成，不重复计数
- **同一专题多难度**：只算 1 个已完成（distinct collection_id）

---

## 五、勋章系统

### 5.1 勋章展示
- 每个专题对应一枚勋章（PNG/SVG 图）
- 勋章墙入口：首页右上角"🎖 我的勋章"（未登录时灰色锁状态，点击引导登录）
- 勋章墙按星级分组：★1-2 入门 / ★3-4 进阶 / ★5-6 精通 / ★7-8 大师
- 每枚勋章显示：专题名 / 难度 / 玩法 / 用时 / 获得日期

### 5.2 勋章等级
| 等级 | 条件 | 视觉 |
|---|---|---|
| 铜勋章 | easy 单人完成 | 铜色边框 |
| 银勋章 | hard 单人完成 | 银色边框 |
| 金勋章 | easy + hard + easy PK + hard PK 全部完成 | 金色发光 |
| 钻石勋章 | 全模式用时进入前 10 | 钻石特效 |

---

## 六、专题排行榜

### 6.1 排行维度
| 排行榜 | 维度 | 展示 |
|---|---|---|
| 单专题排行 | 单一专题 + 难度 + 玩法 | Top 50 用时 |
| 总榜 | 所有专题总用时 | 全站 Top 100 |
| 勋章数榜 | 勋章总数 | 全站 Top 100 |

### 6.2 入榜规则
- **必须登录**才能上榜（匿名玩家即使完成也不入榜，但可保留进度）
- 同一专题同模式只取最快用时
- 排行榜每日 0 点缓存刷新（避免高频查询）

---

## 七、邮箱登录引导

### 7.1 触发时机
| 时机 | 行为 |
|---|---|
| 专题完成时（未登录） | 弹窗"🏆 恭喜获得 [专题名] 勋章！绑定邮箱领取" → 不登录则无勋章（简单粗暴） |
| 专题完成时（已登录） | 勋章直接入库，结算页显示 |
| 勋章墙点击灰色勋章 | 弹窗"完成 [专题名] 即可解锁，绑定邮箱后勋章永久保留" |

### 7.2 登录流程
复用 `points-system-plan.md` 的邮箱登录：
1. 输入邮箱 → 后端发 6 位验证码
2. 输入验证码 → 登录成功
3. **昵称沿用提示**（详见 §7.3）
4. **匿名期进度合并**：按 session_id 将已完成专题数合并到 user_id（从 `player_sessions` 聚合查询）

### 7.3 昵称沿用机制（与 PK 昵称打通）

**背景**：现有 PK 模式玩家进入房间时需要输入昵称（存于 `player_sessions.nickname`，非全局唯一）；专题模式引入邮箱登录后，登录用户拥有**全局唯一昵称**（`users.nickname` 已是 `unique=True`）。两套昵称需要打通，避免玩家"登录后还要再起一个名字"的割裂感。

#### 7.3.1 昵称来源优先级
| 场景 | 昵称来源 | 唯一性 |
|---|---|---|
| 未登录玩 PK | 玩家进入房间时输入 | 房间内唯一，跨房间不保证 |
| 未登录玩专题（单点） | 同 PK，可输入或随机 | 不强制 |
| 邮箱注册时 | **沿用最近一次 PK 昵称** 或让用户输入新昵称 | 全局唯一 |
| 登录后玩任意模式 | 直接用 `users.nickname` | 全局唯一 |

#### 7.3.2 注册时的昵称沿用流程
```
玩家输入邮箱 + 验证码通过
   ↓
后端查该 session_id 最近 30 天内的 player_sessions.nickname（去重、取最新）
   ↓
有历史昵称？
├─ 有 → 前端弹窗"检测到你曾用昵称【XXX】，是否沿用？"
│        ├─ 沿用 → 校验 XXX 是否已被其他用户占用
│        │        ├─ 未占用 → 直接作为注册昵称
│        │        └─ 已占用 → 后端生成 3-5 个推荐昵称（基于 XXX 加数字后缀，如"张三2026"/"张三_旅行者"，校验未占用）→ 前端展示"该昵称已被占用，试试这些？" + 用户可自选或自定义输入
│        └─ 换一个 → 输入新昵称 → 校验全局唯一 → 通过
└─ 无历史昵称 → 直接让用户输入新昵称 → 校验全局唯一
   ↓
校验规则：
- 长度 2-16 字符
- 不含敏感词（接 sensitive_words 表或简单正则）
- 全局唯一（users.nickname unique 约束）
- 大小写敏感（"哈哈A" 与 "哈哈a" 是两个不同用户）
   ↓
注册成功 → users.nickname 入库
```

#### 7.3.3 登录后 PK 昵称的处理
- 登录用户进入 PK 房间时，**自动用 `users.nickname` 作为 PK 昵称**，不再让玩家输入
- 房间内显示的昵称即登录昵称，保证身份一致性
- 房间内昵称唯一性仍由 PK 房间逻辑保证（同一房间不允许重名）

#### 7.3.4 昵称修改
- 登录用户可在"我的"页面修改昵称
- 修改时同样校验全局唯一
- 修改昵称不影响已获得的勋章和历史对局记录（历史记录按当时的昵称快照保留）
- **待讨论**：修改昵称是否需要限制频率以防频繁修改

#### 7.3.5 匿名昵称与登录昵称冲突的处理
| 情况 | 处理 |
|---|---|
| 匿名玩家 A 用"张三"玩了 PK，后注册时沿用"张三"，但"张三"已被注册 | 后端生成"张三2026"/"张三_旅行者"等推荐昵称，A 可自选或自定义 |
| 匿名玩家 A 用"张三"玩了 PK，玩家 B 先注册了"张三" | A 的历史 player_sessions.nickname 仍为"张三"（快照），但 A 注册时不能用"张三" |
| 登录用户 A 昵称"张三"，匿名玩家 B 进 PK 也起名"张三" | 允许（PK 房间内昵称不与 users 表打通校验，仅房间内唯一） |
| 同一 session 匿名期用了多个不同昵称 | 取最近一次的昵称作为沿用候选 |

### 7.4 登录奖励清单

本期登录奖励仅为"勋章永久保留 + 排行榜上榜资格"。

---

## 九、待讨论问题清单

### 9.1 运营与平衡

> 已决定：星级解锁（★1 默认开放、完成任意模式算通关）、勋章规则（hard 给勋章 easy 只解锁）、排行榜冷启动（先留空）、专题更新频率（后续再说）、专题难度标记（正文 §4.8 已表达）、作弊检测（短期不考虑）
> 已移至点子池：付费专题（IP-025）、UGC 专题（IP-026）、社交分享（IP-027）

（无待讨论问题）

### 9.2 登录与奖励

> 已决定：不登录无勋章（简单粗暴）、匿名玩家无暂存问题、微信登录后续再说（需缴费）、验证码不做限制、昵称沿用用当前机制（无则新生成/自起）、昵称大小写敏感（哈哈A≠哈哈a）、昵称修改不限制、匿名期多昵称取最近一次（前端只有一个 session）、轻量引导按 §7.0 现状

（无待讨论问题）

### 9.3 几何图形
> 已移至 [idea-pool.md](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/docs/idea-pool.md) IP-012，等具体设计专题时再考虑。

---

## 十、分阶段落地建议

### 阶段一（MVP · 基础框架 + 试运行）
- 搭建专题模式基础框架（数据表、接口、前端骨架）
- 先上 **3-5 个专题**试运行（验证流程跑通）
- 邮箱登录（最小实现：验证码登录，无密码）
- 勋章入库 + 勋章墙展示
- 单人 easy 模式

### 阶段二
- 补齐 100 个专题
- 加 hard 模式 + PK 专题
- 专题排行榜
- 几何图形渲染（移至 [idea-pool.md](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/docs/idea-pool.md) IP-012，等具体设计专题时再考虑）

### 阶段三
- 勋章等级（铜银金钻）
- UGC 专题
- 付费专题包
- 社交分享

---

## 十一、下一步

所有待讨论问题已回答完毕，文档进入可实现状态。
