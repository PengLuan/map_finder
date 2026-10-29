# 地图猜图后台管理 + UGC 素材方案

## 一、无登录玩家行为统计

### 1.1 问题

当前无登录体系，无法追踪玩家行为。需要在不强制登录的前提下，统计：
- 哪个 IP 玩了多久
- 玩了哪个模式（全国/省份/主题 × 简单/困难）
- 用了什么昵称（PK 模式有昵称，单人模式无）

### 1.2 数据采集

#### 数据库表 `player_sessions`

```sql
CREATE TABLE player_sessions (
  id          BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id  VARCHAR(64)  NOT NULL COMMENT '前端生成的 UUID',
  ip          VARCHAR(45)  NOT NULL,
  nickname    VARCHAR(32)  NULL     COMMENT 'PK 模式的昵称',
  ua          VARCHAR(256) NULL     COMMENT '浏览器 User-Agent',
  mode        VARCHAR(20)  NOT NULL COMMENT 'national/provincial/theme',
  region_code VARCHAR(12)  NULL     COMMENT '省份模式 adcode',
  category    VARCHAR(32)  NULL     COMMENT '主题 code',
  difficulty  VARCHAR(10)  NOT NULL COMMENT 'easy/hard',
  game_type   VARCHAR(10)  NOT NULL COMMENT 'solo/pk',
  target_poi_id BIGINT     NULL,
  won         TINYINT(1)   DEFAULT 0,
  score       INT          DEFAULT 0,
  duration_sec INT         DEFAULT 0 COMMENT '本局耗时',
  started_at  DATETIME     NOT NULL,
  ended_at    DATETIME     NULL,
  INDEX idx_ip (ip),
  INDEX idx_started (started_at),
  INDEX idx_mode (mode, difficulty)
);
```

#### 前端

- 进入游戏页时生成 `session_id`（UUID），存 localStorage
- 调用 `POST /api/admin/session` 上报开局信息
- 游戏结束时调用 `POST /api/admin/session/{id}/end` 上报结果
- 已有的 PK 昵称直接带上；单人模式可弹出一次性昵称输入框（可选，不强制）

#### 后端

- 新增 `app/api/admin.py` 路由
- 通过 `request.client.host` 获取 IP
- 通过 `request.headers.get('user-agent')` 获取 UA
- 用 UA 解析设备类型（PC/Mobile）和操作系统

### 1.3 后台展示

路由 `GET /api/admin/sessions` 支持筛选：
- 时间范围、IP、昵称、模式、难度
- 返回分页列表

后台页面（`/admin`）：
- **概览面板**：今日 DAU、今日对局数、平均时长、模式分布饼图
- **会话列表**：IP、昵称、模式、难度、结果、时长、时间
- **IP 汇总**：按 IP 聚合，显示总对局数、总时长、最后活跃时间

---

## 二、后台 POI 管理

### 2.1 问题

目前 POI 数据通过 SQL 脚本批量导入，无法在线增删改查。需要后台支持：
- 添加主题
- 给省份/主题添加定位点（POI）
- 修正已有 POI 的坐标/名称/封面

### 2.2 后台 API

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/admin/themes` | 主题列表 |
| POST | `/api/admin/themes` | 新增主题 |
| PUT | `/api/admin/themes/{code}` | 修改主题 |
| DELETE | `/api/admin/themes/{code}` | 删除主题（需无关联 POI） |
| GET | `/api/admin/pois` | POI 列表（支持按主题/省份筛选+分页） |
| POST | `/api/admin/pois` | 新增 POI |
| PUT | `/api/admin/pois/{id}` | 修改 POI（名称/坐标/封面/难度） |
| DELETE | `/api/admin/pois/{id}` | 删除 POI（需解除游戏记录外键） |

### 2.3 POI 表扩展

现有 `pois` 表新增字段（统一用 `shape_type` 描述目标形态，支持点/圆/多边形三种判定）：

```sql
ALTER TABLE pois
  ADD COLUMN verify_status  VARCHAR(20) DEFAULT 'approved' COMMENT 'approved/pending/rejected',
  ADD COLUMN submitted_by   VARCHAR(64)  NULL COMMENT '提交者 session_id',
  ADD COLUMN shape_type     VARCHAR(10)  DEFAULT 'point'
                             COMMENT 'point=点判定 / circle=圆形范围 / polygon=多边形范围',
  ADD COLUMN radius_km      FLOAT        DEFAULT 0
                             COMMENT 'shape_type=circle 时的判定半径(km)，0 表示点判定',
  ADD COLUMN area_geojson   TEXT         NULL
                             COMMENT 'shape_type=polygon 时的 GeoJSON Polygon/MultiPolygon 字符串',
  ADD INDEX idx_shape (shape_type);
```

- `point`（默认）：沿用现有单点逻辑，向后兼容
- `circle`：以 `(lng,lat)` 为圆心、`radius_km` 为半径的圆，适合近似圆形的湖泊/景区
- `polygon`：用 `area_geojson` 存任意多边形边界，适合带状/不规则区域（河流、海岸段、保护区）

### 2.4 后台页面

`/admin/pois`：
- 左侧筛选：主题 / 省份 / 难度 / 审核状态 / **目标形态(point/circle/polygon)**
- 右侧表格：名称、坐标、封面缩略图、所属主题/省份、难度、**形态**、审核状态
- 点击行打开编辑弹窗：
  - 名称、坐标（经纬度）、adcode、难度
  - 封面图 URL
  - **目标形态切换**：点 / 圆形 / 多边形（见 2.5）
  - 圆形：半径输入框（km）+ 小地图圆圈预览
  - 多边形：小地图绘制工具，支持手绘多边形 / 矩形 / 导入 GeoJSON
  - 地图预览（Leaflet 小地图，可拖拽修正坐标）

### 2.5 坐标与范围绘制交互

编辑弹窗内嵌一个 Leaflet 小地图，集成 `leaflet-draw` 绘制工具：

**坐标修正（所有形态通用）：**
- 初始定位到 POI 当前坐标
- 点击/拖拽标记修正中心点
- 支持搜索地点名（高德 Place API）辅助定位

**范围绘制（按形态）：**
- `point`：仅一个可拖拽标记，无范围
- `circle`：半径输入框 + 地图上可拖拽圆（`L.circle`），实时显示半径
- `polygon`：进入绘制模式，点击地图逐点添加顶点，双击/回车闭合；支持：
  - 手绘多边形（`leaflet-draw` 的 polygon 工具）
  - 矩形工具（一键画外接矩形，适合规整景区）
  - 顶点编辑（拖拽顶点微调、右键删除顶点）
  - 导入 GeoJSON（粘贴 Polygon/MultiPolygon 文本，校验后渲染）
  - 导出 GeoJSON（便于复制到其他 POI）

绘制完成后，前端将图形序列化为 GeoJSON 存入 `area_geojson`，保存时调用 `PUT /api/admin/pois/{id}`。多边形顶点建议 ≥4 个（首尾闭合），面积过大（>1000km²）时给出确认提示。

---

## 三、区域范围判定系统

### 3.1 问题

当前胜利判断把所有目标当作**单点**处理：
- 简单模式：点击点到目标点的 haversine 距离 ≤ 0.5km 才算命中
- 困难模式：目标点落入视野矩形才算命中

但很多真实目标是**大面积区域**（石臼湖、太湖、张家界、呼伦贝尔草原、长江某段、海岸线保护区），玩家根本无法精确点到"某个经纬度坐标"，导致：
- 简单模式点击湖面却显示"未命中"（因为点偏离了入库的中心坐标）
- 困难模式视野框明明罩住了整个湖却判负（因为中心点不在框内）
- 体验割裂：玩家看到的"目标"和系统判定的"目标"不是一回事

更关键的是，这类区域**形状不规则**：湖泊近似圆/椭圆、河流是带状、保护区是多边形。单一圆形 `radius_km` 无法准确覆盖。需要一套系统性的区域判定工程。

### 3.2 设计目标

1. **后台能框定任意范围**：支持点 / 圆 / 多边形三种形态，多边形可表达任意边界
2. **后端判定算法统一**：简单模式"点击落入范围即赢"，困难模式"视野框与范围有交集即赢"
3. **前端胜利展示与判定一致**：结算时把目标真实范围画在地图上，让玩家明白为什么赢/输
4. **向后兼容**：未配置范围的 POI 默认 `point`，沿用现有阈值逻辑，老数据无需迁移

### 3.3 数据模型

见 2.3，`pois` 表新增三字段：
- `shape_type`：`point` / `circle` / `polygon`
- `radius_km`：circle 的半径
- `area_geojson`：polygon 的 GeoJSON（Polygon 或 MultiPolygon）

`area_geojson` 约定：

```json
{
  "type": "Polygon",
  "coordinates": [ [ [lng, lat], [lng, lat], ... , [lng, lat] ] ]
}
```

- 外环首尾顶点必须相同（闭合）
- 经纬度顺序遵循 GeoJSON 规范：`[lng, lat]`
- MultiPolygon 用于飞地/多片区域（如群岛景区）
- 不引入 PostGIS / MySQL Spatial，纯 Python 算法判定，避免运维复杂度

### 3.4 后端判定算法

新增 `app/services/geometry.py`，封装三种判定：

#### 点-目标判定（简单模式 `click_target`）

```python
def point_hits_target(lng, lat, poi) -> bool:
    if poi.shape_type == "polygon":
        return point_in_polygon(lng, lat, poi.area_geojson)
    if poi.shape_type == "circle" and poi.radius_km > 0:
        return haversine_km(lng, lat, poi.lng, poi.lat) <= poi.radius_km
    # point：沿用 0.5km 阈值
    return haversine_km(lng, lat, poi.lng, poi.lat) <= EASY_CLICK_THRESHOLD_KM
```

`point_in_polygon` 用射线法（ray casting），支持 Polygon 与 MultiPolygon：

```python
def point_in_polygon(lng, lat, geojson) -> bool:
    geom = json.loads(geojson)
    if geom["type"] == "Polygon":
        return _ring_contains(lng, lat, geom["coordinates"][0])  # 外环
    # MultiPolygon：任一子多边形包含即命中
    return any(_ring_contains(lng, lat, poly[0]) for poly in geom["coordinates"])
```

`click_target` 改造：

```python
# game.py click_target 中
dist = haversine_km(lng, lat, game.target_lng, game.target_lat)
poi = db.query(POI).filter(POI.id == game.target_poi_id).first()
if not point_hits_target(lng, lat, poi):
    # 未命中：距离提示改为"到范围边界最近距离"，让玩家知道差多远
    edge_dist = distance_to_target_edge(lng, lat, poi)
    return {"hit": False, "distance_hint": distance_bucket(edge_dist)}
# ... 命中逻辑不变
```

#### 矩形-目标判定（困难模式 `check_view`）

```python
def rect_hits_target(west, south, east, north, poi) -> bool:
    if poi.shape_type == "polygon":
        return rect_intersects_polygon(west, south, east, north, poi.area_geojson)
    if poi.shape_type == "circle" and poi.radius_km > 0:
        return rect_intersects_circle(west, south, east, north,
                                      poi.lng, poi.lat, poi.radius_km)
    # point：目标点在视野框内
    return west <= poi.lng <= east and south <= poi.lat <= north
```

`rect_intersects_polygon`（分离轴定理简化版，三者满足其一即相交）：
1. 多边形任一顶点在矩形内
2. 矩形任一角点在多边形内
3. 多边形任一条边与矩形任一条边相交

`rect_intersects_circle`：
1. 圆心在矩形内 → 相交
2. 否则圆心到矩形最近边的距离 ≤ radius → 相交

`check_view` 改造：

```python
# game.py check_view 中（删除简单模式直接 return hit:False 的分支，
# 因为 area 目标在简单模式同样用 click_target，check_view 仍只服务困难模式）
if game.difficulty == "easy":
    return {"hit": False}
poi = db.query(POI).filter(POI.id == game.target_poi_id).first()
if not rect_hits_target(west, south, east, north, poi):
    return {"hit": False}
# ... 命中逻辑不变
```

PK 模式（`pk.py`）的 `click_target` / `check_view` 同步改造，复用 `geometry.py`。

#### `distance_to_target_edge`（未命中距离提示）

- `point`：haversine 到中心点
- `circle`：max(0, haversine 到中心 - radius)
- `polygon`：到多边形边界最近顶点/边的距离（近似，用顶点距离最小值即可，无需精确点到线段）

### 3.5 前端胜利判断机制优化

前端不做判定（仍由服务端权威），但需优化**胜利展示**与**未命中反馈**，使玩家感知与判定一致。

#### 结算面板：画出目标真实范围

当前结算只画一个点标记（`Game.tsx` / `PKGame.tsx` 里的 target marker）。改为按 `shape_type` 渲染：

```ts
// 命中后服务端响应新增 target_shape 字段
interface CheckViewResponse {
  // ... 现有字段
  target_shape?: {
    type: 'point' | 'circle' | 'polygon'
    lng: number; lat: number
    radius_km?: number
    geojson?: GeoJSON.Geometry
  }
}
```

- `point`：红色倒水滴标记（现有 `PICK_ICON`）
- `circle`：红色圆面（`L.circle`，半透明填充 + 实线描边）
- `polygon`：红色多边形面（`L.polygon`，半透明填充 + 实线描边）

这样玩家在结算时能直观看到"我点中了整片湖区"或"我的视野框罩住了整个保护区"。

#### 未命中反馈

简单模式未命中时，`distance_hint` 现在是到范围边界的距离，文案优化：
- 点目标："未命中，距目标约 1-5km"
- 范围目标："未命中，距湖区边界约 1-5km"（区分点/面，让玩家知道目标是范围）

#### 困难模式视野框反馈

`check_view` 在区域目标下命中条件放宽（框与范围有交集即可），为避免玩家"以为没罩住却赢了"的困惑，命中瞬间在地图上高亮视野框与目标范围的**交集区域**（黄色半透明），作为"为什么赢了"的可视化解释。

#### API 响应扩展

`click_target` / `check_view` 命中响应统一追加：

```json
{
  "hit": true,
  "target_shape": {
    "type": "polygon",
    "lng": 119.12, "lat": 31.45,
    "geojson": { "type": "Polygon", "coordinates": [...] }
  }
}
```

`give_up` 同样返回 `target_shape`，便于放弃时也展示真实范围。

### 3.6 后台配置

见 2.4 / 2.5，POI 编辑弹窗支持三种形态切换与绘制。配置建议：

- **点**：默认，适合单体建筑、雕像、车站等精确定位点
- **圆形**：适合近似圆形的湖泊/景区，半径 1-10km
- **多边形**：适合河流、海岸段、带状山脉、不规则保护区

### 3.7 需要范围判定的 POI 示例

| 名称 | 建议 shape_type | 建议 radius_km / 说明 |
|------|----------------|----------------------|
| 石臼湖 | circle | 3 |
| 太湖 | polygon | 多边形勾画实际湖岸线 |
| 千岛湖 | circle | 5 |
| 张家界国家森林公园 | polygon | 不规则景区边界 |
| 呼伦贝尔大草原 | polygon | 大范围草原，多边形外接 |
| 长江（某江段） | polygon | 带状多边形 |
| 三江源保护区 | polygon | 多边形保护区边界 |

---

## 四、前台 UGC 素材提交

### 4.1 问题

需要开放用户提交地点素材，让平台内容越做越大。涉及：
- 用户提交 POI（名称、坐标、分类、封面图）
- 提交的 POI 需要后台审核
- 审核通过后进入题库
- 封面图需要上传到 OSS

### 4.2 提交流程

```
用户在首页点"贡献地点"
  → 填写表单（名称、所在省份、主题分类、简单描述）
  → 地图上点击标记坐标（或搜索地点名自动定位）
  → 选择目标形态：点 / 圆形范围 / 多边形范围（可选，默认点）
     · 圆形：输入半径，地图显示圆圈
     · 多边形：在地图上勾画边界（适合湖泊/公园/保护区）
  → 上传封面图（可选，支持拍照/相册）
  → 填写昵称（用于审核通过后的"贡献者"展示）
  → 提交
  → 后台审核
  → 通过 → 入库（verify_status=approved，携带 shape 信息）
  → 驳回 → 标记 rejected（不展示）
```

### 4.3 数据库

新增 `poi_submissions` 表（含建议范围字段，审核通过后复制到 `pois`）：

```sql
CREATE TABLE poi_submissions (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id    VARCHAR(64)  NOT NULL COMMENT '提交者 session_id',
  nickname      VARCHAR(32)  NULL,
  name          VARCHAR(128) NOT NULL,
  province_code VARCHAR(12)  NULL,
  category      VARCHAR(32)  NULL     COMMENT '建议主题',
  lng           DECIMAL(10,6) NOT NULL,
  lat           DECIMAL(10,6) NOT NULL,
  description   TEXT         NULL,
  cover_url     VARCHAR(512) NULL     COMMENT 'OSS URL',
  suggested_shape_type VARCHAR(10) DEFAULT 'point' COMMENT 'point/circle/polygon',
  suggested_radius_km  FLOAT        DEFAULT 0,
  suggested_area_geojson TEXT       NULL,
  status        VARCHAR(20)  DEFAULT 'pending' COMMENT 'pending/approved/rejected',
  reviewer_note VARCHAR(256) NULL     COMMENT '驳回原因',
  submitted_at  DATETIME     NOT NULL,
  reviewed_at   DATETIME     NULL,
  INDEX idx_status (status),
  INDEX idx_submitted (submitted_at)
);
```

### 4.4 前台页面

`/contribute`（无需登录）：
- 表单：名称、省份下拉、主题下拉、描述
- 地图组件：点击放置标记 / 搜索框（高德 Place API 辅助定位）
- **目标形态选择（可选）**：点 / 圆形 / 多边形
  - 圆形：半径输入框 + 地图圆圈预览（提示"适合湖泊/景区"）
  - 多边形：地图勾画工具（提示"适合河流/保护区，可在审核时修正"）
  - 用户不确定时默认点，审核员可在后台补画
- 封面上传：调用后端 `/api/upload`，后端转存 OSS
- 昵称输入（可选）
- 提交成功后显示："感谢贡献！审核通过后将出现在题库中"

### 4.5 后台审核

`/admin/submissions`：
- 待审核列表：名称、坐标小地图预览（含建议范围叠加层）、封面缩略图、描述
- 审核操作：
  - **通过** → 创建 POI 入 `pois` 表（verify_status=approved，`shape_type`/`radius_km`/`area_geojson` 取自建议值或审核员修正），submission 标记 approved
  - **驳回** → 填写驳回原因，submission 标记 rejected
  - **修改后通过** → 可编辑坐标/名称/分类/范围后再入库（范围编辑复用 2.5 的绘制工具）

### 4.6 封面图上传

- 前端上传到后端 `/api/upload`（multipart/form-data）
- 后端接收后上传到 OSS（阿里云 OSS SDK）
- 返回 OSS URL 存入 `poi_submissions.cover_url`
- 审核通过时复制到 `pois.cover_url`
- 限制：单张 < 2MB，格式 jpg/png/webp

### 4.7 防滥用

- 同一 session_id 每日最多提交 5 个
- 名称/描述做敏感词过滤
- 坐标必须在中国境内（经纬度范围校验）
- 封面图做基本尺寸校验（最小 400×300）

### 4.8 贡献者展示

POI 结算面板中，如果该 POI 由用户贡献，显示：
"📍 本题由「昵称」贡献"

在 POI 表新增 `contributor_nickname` 字段。

---

## 五、后台认证

### 5.1 简单方案

- 后台路由 `/admin/*` 需要管理员 token
- 环境变量 `ADMIN_TOKEN` 配置
- 后台页面登录时输入 token，存 localStorage
- 所有 admin API 请求带 `Authorization: Bearer {token}`
- 不需要用户系统，单管理员即可

### 5.2 前端路由

- `/admin` — 概览面板
- `/admin/sessions` — 玩家会话
- `/admin/pois` — POI 管理
- `/admin/submissions` — 待审核素材
- `/contribute` — 前台用户贡献（无需认证）

---

## 六、实施优先级

| 优先级 | 模块 | 说明 |
|--------|------|------|
| P0 | 后台认证 + POI 管理 | 先能管理现有数据 |
| P0 | 区域范围判定 · 数据层 | `pois` 加 `shape_type`/`radius_km`/`area_geojson` 三字段，默认 `point` 向后兼容 |
| P0 | 区域范围判定 · 后端算法 | 新增 `geometry.py`（点入多边形/矩形相交多边形/矩形相交圆），改造 `game.py` 与 `pk.py` 的 `click_target`/`check_view` |
| P0 | 区域范围判定 · 后台绘制 | POI 编辑弹窗集成 `leaflet-draw`，支持点/圆/多边形绘制与 GeoJSON 导入导出 |
| P1 | 区域范围判定 · 前端展示 | 结算面板按 `shape_type` 渲染目标范围，未命中距离提示改为到边界距离，困难模式高亮交集 |
| P1 | 玩家行为统计 | 采集 + 概览面板 |
| P1 | UGC 提交 + 审核 | 前台表单（含建议范围）+ 后台审核 |
| P2 | 贡献者展示 | 结算面板署名 |

---

## 七、技术选型

- 后台前端：复用现有 React + Tailwind，新增 `/admin` 路由
- 图表：轻量库（如 recharts）或直接用 CSS 柱状图
- 地图组件：复用 Leaflet
- 范围绘制：`leaflet-draw`（多边形/矩形/圆绘制与顶点编辑）+ `@turf/turf`（前端几何校验，可选）
- 几何判定：后端纯 Python 实现（射线法点入多边形、矩形相交多边形/圆），不依赖 PostGIS / MySQL Spatial
- 文件上传：后端接收 → OSS SDK 上传
- 敏感词：开源词库 + 简单匹配
