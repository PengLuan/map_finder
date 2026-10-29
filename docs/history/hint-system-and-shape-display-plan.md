# 提示系统重构 + 目标范围显示策略（PC/移动双端）

> 状态：方案文档（不改代码）
> 范围：单人 + PK 通用；简单/困难模式提示机制；目标范围"后台显示 / 前台判定不显示"策略；PC/移动差异化
> 关联文档：`hard-mode-control-ux.md`（操作栏）、`hard-mode-difficulty-reflection.md`（难度矩阵）、`newbie-onboarding-analysis.md`（新手门槛）、`history/admin-and-ugc-plan.md`（区域判定）

---

## 1. 现状与问题

### 1.1 提示系统现状

后端 `get_hint`（[game.py#L362-L415](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/backend/app/services/game.py#L362-L415)）实现 4 级分级解锁提示（不可反复）：level 1 目标省(0分)、level 2 方位+距离(0分)、level 3 坐标前1位(-20)、level 4 黄色矩形框(national offset=2.0°/其余 0.5°，-40)。前端 `handleHint`（[Game.tsx#L758-L777](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/frontend/src/pages/Game.tsx#L758-L777)）推入 hints 数组并按 level 4 画 `L.rectangle`。

**问题**：
1. 简单模式主提示是 level 4 黄色矩形，national 4°×4°≈444km 范围过大，对新手等于没提示；矩形是"空间范围"非"行动指引"。
2. 提示分级解锁不可反复，玩家移动后方位过期但旧文案不更新。
3. 无按时间/距离自动触发的救济机制。
4. 距离阈值提示缺失（逼近目标无反馈）。
5. 多边形后台回显 bug（见第 5 节）。
6. 前台结算画出 polygon/circle 范围，违背"范围只用于判定不暴露"设计。
7. 玩家当前位置反查未实现（"经纬度→省/市"）。
8. PC/移动端无差异化，目标图片开局不展示。

### 1.2 其他现状

- 倒计时（[Game.tsx#L450-L463](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/frontend/src/pages/Game.tsx#L450-L463)）仅用于显示与超时，无"时间过半/80%"钩子。`effective_time_limit`（[game.py#L71-L74](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/backend/app/services/game.py#L71-L74)）简单模式时限减半。
- 视野中心 `map.getCenter()` → `api.updateView` → `game.view_lng/view_lat`（[Game.tsx#L507-L518](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/frontend/src/pages/Game.tsx#L507-L518)）；视野四角 `map.getBounds()` → `checkView`（仅困难模式）。
- 方位反查 `bearing_degrees` + `bearing_to_chinese` 已实现，但只反查目标 POI 省，未反查当前视野省/市。
- 数据模型 `pois.shape_type`/`radius_km`/`area_geojson` 已迁移；[geometry.py](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/backend/app/services/geometry.py) 已实现 `point_hits_target`/`rect_hits_target`/`distance_to_target_edge`；`target_shape_dict`（[geometry.py#L203-L217](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/backend/app/services/geometry.py#L203-L217)）在 `check_view`/`click_target`/`give_up` 下发 `target_shape`；前台 `renderTargetShape`（[Game.tsx#L231-L247](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/frontend/src/pages/Game.tsx#L231-L247)）已画 polygon/circle 到结算面板；后台 [POIEditor.tsx#L186-L200](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/frontend/src/components/admin/POIEditor.tsx#L186-L200) 尝试加载 geojson。
- 结算 `_calc_score`（[game.py#L453-L470](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/backend/app/services/game.py#L453-L470)）：基础100 + 时间加成(≤50) - 距离惩罚 - 提示扣分(level3 -20/level4 -40)，保底10。
- 双端唯一分支：结算偏移 `window.innerWidth >= 768 ? 200 : 0`（[Game.tsx#L278](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/frontend/src/pages/Game.tsx#L278)）。

---

## 2. 设计原则

1. **判定后端权威**：前端不做判定，只展示与上报视野。polygon/circle 判定全在 [geometry.py](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/backend/app/services/geometry.py)，前后台共用。
2. **范围是判定依据非显示对象**：前台不画 polygon/circle 真实范围（防靠形状命中）；后台画出（便于审核修正）。
3. **提示是行动指引非答案**：给"方向+距离区间+行政区"，不给精确坐标/范围形状。
4. **PC 弱化、移动强化**（核心，适用所有模式与玩法）：PC 屏大视野广操作强→找目标易→提示弱化；移动屏小视野窄操作弱→找目标难→提示强化。差异体现在频次/精度/时长/视觉钩子四维度。反例澄清：PC"信息密度高"指操作面板与历史展示丰富，非提示更多。
5. **积分=机会，配额与扣分双约束**：开局 `hint_credits=100`，主动提示消耗积分（PC 单次扣分高/移动低），归零后主动提示禁用（403）。配额限制"能请求几次"，积分限制"实际能用几次"，取交集。自动救济（B/C）不消耗积分，归零后仍触发（兜底）。

---

## 3. 优化方案

### 3.1 简单模式：从"框定区域"改为"方向提示"

- **移除黄色矩形**：简单模式不再用 level 4 的 `hintRectRef`/`L.rectangle`。`get_hint` 在 `difficulty=="easy"` 时 level 4 改为返回"目标相对当前落点的方向+距离区间"，与 level 2 同形态但以落点 marker 为基准（[Game.tsx#L168](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/frontend/src/pages/Game.tsx#L168) `pickMarkerRef` 的 `picked.lng/lat`，未放置回退视野中心）。
- **方向提示可反复**：后端 `get_hint` 简单模式 level 2/4 不再校验 `hint_level` 单调递增，允许同 level 反复调用，每次返回实时方位+距离区间。前端 `handleHint` 改为"刷新最新一条方向提示"非 append，UI 常驻小气泡每次点击刷新。
- **距离区间**：复用 [game.py#L56-L68](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/backend/app/services/game.py#L56-L68) 的 `distance_bucket`（1km以内/1-5/5-20/20-100/100-300/300+），防三角定位。文案示例："目标在落点东南方向，约 20-100km"。

### 3.2 困难模式：分级提示 + 自动救济

保留现有 4 级手动分级提示，新增 3 条自动救济（不扣分，系统按时间/距离触发）：

- **A 屏幕中心方位救济**（手动按钮 💡，困难专属）：返回当前屏幕中心→目标方向（8方位中文）+ 屏幕中心相对上一秒的变化方向。3 秒 toast。新增 `GET /api/game/{id}/bearing-hint` 返回 `{ target_bearing, target_distance_bucket, center_delta_dir }`。`center_delta_dir` 由后端对比 `game.view_lng/lat` 与上次 `updateView` 快照计算（需 `game_records` 加 `prev_view_lng/lat` 或 Redis 缓存）。次数按 device 校验，超限 403。
- **B 距离≤阈值方向提示**（自动）：`haversine_km(view, target) <= 阈值` 时自动展示当前→目标方向（8方位），3 秒，防抖（移动≥Xkm 才能再触发）。实现：前端 `syncAndCheck`（[Game.tsx#L507-L518](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/frontend/src/pages/Game.tsx#L507-L518)）每次视野变化调 `checkView`，让 `checkView` 响应新增 `distance_bucket` 字段触发 toast。后端 `check_view` 在 `hit=false` 时返回 `distance_bucket`（困难模式矩形判定需补"视野中心到目标范围边界"距离）。不限次，不扣分。
- **C 时间过半/80% 行政区提示**（自动）：剩余≤阈值时若当前视野不在目标所在省/市，提示"当前所在省/市：XX"（不暴露目标省/市）。每阈值各 1 次。前端倒计时 `useEffect` 按 `timeLeft/timeLimit` 比例触发，调 `GET /api/game/{id}/location-hint?stage=province|city`。不扣分。

### 3.3 目标范围显示策略：后台显示，前台不显示

- **前台**（[Game.tsx#L231-L247](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/frontend/src/pages/Game.tsx#L231-L247) `renderTargetShape`）：`point` 保留红色倒水滴 `PICK_ICON`；`circle`/`polygon` **不画范围面**，只画红色倒水滴在 `shape.lng/lat`，与 point 视觉一致。后端仍下发 `target_shape`（含 `geojson`/`radius_km`），前端忽略图形字段只读 `lng/lat`。PK 同步改 [PKGame.tsx](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/frontend/src/pages/PKGame.tsx) 对应 `renderTargetShape`。判定逻辑不变（点击落点/视野与范围相交仍判中）。文案配合：未命中 `distance_hint` 区间不变；命中 `target_summary` 可补"目标是一片区域"（可选）。
- **后台**：修复 [POIEditor.tsx#L186-L200](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/frontend/src/components/admin/POIEditor.tsx#L186-L200) 回显 bug（见第 5 节）；[POIManager.tsx](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/frontend/src/pages/admin/POIManager.tsx) 行展开显示范围缩略图；后台复盘页可显示真实范围。

### 3.4 玩家当前位置反查（后端新增）

困难 C 救济依赖。两种方案：

| 方案 | 实现 | 优点 | 缺点 |
|---|---|---|---|
| A. 高德 regeo | `restapi.amap.com/v3/geocode/regeo?location={lng},{lat}&key={AMAP_KEY}` | 精确含 adcode | 依赖外部、有配额、延迟 |
| B. 本地 regions bbox | `regions` 表加 `bbox_w/s/e/n`，遍历省/市找包含点 | 纯本地零延迟无配额 | 边界粗糙，跨省边缘可能误判 |

**推荐 B**（本地 bbox）默认，A 作边缘修正可选。`regions` 表已有省/市数据（[game.py#L420-L424](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/backend/app/services/game.py#L420-L424) `get_regions`），补 bbox 成本低。

新增 `GET /api/game/{id}/location-hint?stage=province|city`：取 `game.view_lng/view_lat` → 本地 bbox 反查省/市 → 对比目标 POI 省/市（`poi.adcode`）。返回：
```json
{ "current_province": "江苏省", "in_target_province": false, "current_city": "南京市", "in_target_city": false }
```

### 3.5 积分（机会）机制

- **核心**：`game_records` 新增 `hint_credits INT DEFAULT 100`。`get_hint`/`bearing-hint` 每次调用先检查 `hint_credits > 0` 且 ≥ 单次消耗，扣减后写回，不足返回 403。前端顶部条常驻 `⚡ 72/100`，≤20 变红 `text-red-400` 脉动。提示按钮旁标注单次消耗（如 `💡 方位 (-5)`）。403 时 toast "机会已用完，无法获取更多提示"。结算面板展示"剩余机会：XX 分 → 加 +X 分"。
- **单次消耗规则**（PC 单次扣分高/移动低，配额与扣分双约束取交集）：

| 提示类型 | 模式 | PC扣分 | 移动扣分 | 配额(PC/移动) |
|---|---|---|---|---|
| level 1 目标省 | 简单/困难 | 5 | 3 | 1/1 |
| 简单方向提示(level 2/4 合并) | 简单 | 10 | 5 | 3/10 |
| level 2 方位+距离 | 困难 | 10 | 5 | 1/1 |
| level 3 坐标前1位 | 简单/困难 | 25 | 15 | 1/1 |
| level 4 矩形框 | 简单/困难 | 35 | 25 | 1/1 |
| 困难 A 救济 | 困难 | 20 | 12 | 1/2 |
| 困难 B 自动(距离≤阈值) | 困难 | 0 | 0 | 不限(防抖) |
| 困难 C 自动(时间过半/80%) | 困难 | 0 | 0 | 1+1/1+1 |
| 移动端落点后自动方位 toast | 简单 | — | 0 | 1(不消耗) |

- **消耗演算**（极限使用）：
  - 移动简单：3+50+15+25=93 → 剩7（配额用尽，不归零）
  - PC 简单：5+30+25+35=95 → 剩5（配额与积分匹配，基本归零）
  - 移动困难：3+5+24+15+25=72 → 剩28（B/C 自动救济兜底）
  - PC 困难：5+10+20+25+35=95 → 剩5（归零边缘，PC 更克制）
- **归零后行为**：主动提示（level 1-4、A 救济）403 拒绝；自动救济（B/C）仍触发（兜底防卡死）；移动端落点后自动方位 toast 仍触发。
- **结算分数挂钩**：移除 `_calc_score` 原 level3 -20/level4 -40 扣分，改为 `剩余积分×0.5` 加成。公式：`结算分数 = 100 + 时间加成(≤50) - 距离惩罚(每100km -2) + 剩余积分×0.5`，保底 `max(score, 10)`。

### 3.6 双端差异化设计（PC 弱化、移动强化）

- **设备识别**：`Game.tsx`/`PKGame.tsx` 顶部 `const isMobile = window.innerWidth < 768 || /Mobi|Android|iPhone/i.test(navigator.userAgent)`。`start_game` 请求带 `device: 'pc'|'mobile'`，后端存 `game_records.device VARCHAR(10) DEFAULT 'pc'`。所有提示接口从 `game_records.device` 读取端类型按端返回不同阈值与文案——前端不再单独传 device 避免篡改。
- **双端提示强度总览**（所有模式通用的权威定义）：

| 维度 | PC 端（弱化） | 移动端（强化） |
|---|---|---|
| 简单方向提示次数 | 3 次/局 | 10 次/局 |
| 困难 A 救济次数 | 1 次/局 | 2 次/局 |
| 距离区间粒度 | 6 档粗区间(1/1-5/5-20/20-100/100-300/300+) | 4 档精细区间(收窄中段,如20-50/50-100) |
| 方位粒度 | 8 方位(N/NE/E/...) | 16 方位(N/NNE/NE/ENE/...),逼近时更准 |
| B 救济距离阈值 | ≤10km(收紧) | ≤30km(放宽) |
| B 救济防抖 | 移动 ≥10km 才能再触发 | 移动 ≥5km 即可再触发 |
| C 救济省阈值 | 剩余 ≤30% | 剩余 ≤50% |
| C 救济市阈值 | 剩余 ≤15% | 剩余 ≤20% |
| C 救济展示 | 顶部条常驻小字 | 全屏底部弹出条(大字+图标+动画) |
| level 4 矩形框 offset | national 2.0°/其余 0.5°(现状) | national 1.0°/其余 0.3°(更聚焦) |
| 开局目标图片 | 展示 3 秒大图后直接消失 | 展示 3 秒大图→缩小为右上角 48×48 缩略图常驻,命中解除模糊 |
| 提示历史 | 展示全部已解锁列表 | 只展示最新一条,旧的折叠 |
| 操作 | 边缘 8 方向按钮+键盘+巡航 | 仅边缘 8 方向按钮(触摸),无键盘 |
| `hint_credits` 初始 | 100 | 100 |
| 归零后主动提示 | 403 拒绝 | 403 拒绝 |
| 归零后自动救济 | 仍触发 | 仍触发 |

- **开局目标图片**（双端都展示）：`StartResponse` 新增 `target_cover` 字段，后端 `start_game` 追加 `target_cover = cover_url_for(poi)`（[game.py#L127-L141](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/backend/app/services/game.py#L127-L141) 已实现）。前端开局屏幕中央展示大图（PC 320×180/移动 240×135，16:9 圆角）+ 目标名称，3 秒后按端收尾：PC 直接淡出消失（靠记忆找，保持挑战）；移动缩小为右上角 48×48 缩略图常驻 + 目标名称小字（补偿视野劣势，命中后解除模糊展示原图）。模糊：简单 `blur(4px)`/困难 `blur(10px)`，命中或结算解除。交互：3 秒大图可点击跳过；移动缩略图可点击放大回看（不消耗配额/积分）；缩略图位置 top-2 right-2 避开顶部横幅。
- **PK 双端一致性**：双方各自 device 独立判定，各自独立 `hint_credits`。移动强化是补偿固有劣势非特权，PC 键盘+巡航操作层仍占优。上线后按设备分桶统计 PK 胜率，差异过大时微调。
- **移动端已知 bug 待修**（不在本方案范围）：用户反馈"手机装置展示还有一些 bug"待复现；已知风险点：Leaflet 移动端弹窗 invalidateSize 时机、触摸事件与拖拽冲突、小屏顶部条遮挡地图。

---

## 4. 多边形后台显示 Bug 根因分析（前端问题，数据库已确认有数据）

### 4.1 现象

后台 POI 编辑弹窗中，多边形可绘制（绘制工具可用），但已保存的多边形回显不出来。已排除：数据库 `pois.area_geojson` 有数据。问题在 [POIEditor.tsx#L186-L200](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/frontend/src/components/admin/POIEditor.tsx#L186-L200) 加载渲染链路。

### 4.2 前端根因（按概率排序）

加载逻辑在 `useEffect([])`（第 217 行依赖空数组）里同步执行，紧跟地图初始化之后、`invalidateSize` 之前：

1. **地图容器尺寸未就绪致 `fitBounds` 失效**（最可能）：弹窗内 Leaflet 地图在 `useEffect` 挂载时初始化，此时弹窗 DOM 可能未完成布局（高度为 0）。`fg.addLayer(geoLayer)` 成功后立即 `map.fitBounds(fg.getBounds(), { padding: [40, 40] })`（第 195 行），容器尺寸为 0 时 fitBounds 计算无效，图形画到不可见区域或缩放 Infinity。`invalidateSize` 在 `setTimeout 100ms` 后才调（第 203-205 行），晚于 geojson 加载，无法补救已错误的 fitBounds。结果：图层数据层已添加（`fg.getLayers().length > 0`）但视觉不可见。
2. **`geojsonLoadedRef` 未在 POI 切换时重置**：`geojsonLoadedRef.current`（第 187 行）只在加载成功后置 `true`，未在弹窗关闭/POI 切换时重置。组件卸载时 cleanup 调 `map.remove()`（第 208 行），但 `useRef` 重新挂载会重置为 `false`——仅在"弹窗未卸载只换 POI"场景触发（需确认父组件是否传 key 复用实例）。
3. **`useEffect([])` 闭包捕获 poi 初值**：加载分支读闭包里的 `poi?.area_geojson`（第 187 行），依赖空数组只挂载时执行一次。若父组件传 poi 异步（先 null 后填充），挂载时 poi 为 null 跳过加载，之后 poi 更新但 useEffect 不再执行。需确认 [POIManager.tsx](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/frontend/src/pages/admin/POIManager.tsx) 传 poi 时序。
4. **GeoJSON 解析静默失败**：`L.geoJSON(geo)` 解析时若 Polygon 首尾顶点未闭合或坐标顺序错误，可能静默失败。catch 块（第 197-199 行）吞掉异常无日志。

### 4.3 验证步骤（不改代码先诊断）

1. 打开后台 POI 编辑弹窗，选已知 `shape_type='polygon'` 且 `area_geojson` 非空的 POI。
2. Console 在 [POIEditor.tsx#L189](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/frontend/src/components/admin/POIEditor.tsx#L189) `JSON.parse` 后打印 `geo`、`geoLayer.getLayers().length`。
3. Console 在 [POIEditor.tsx#L194](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/frontend/src/components/admin/POIEditor.tsx#L194) 打印 `fg.getLayers().length`、`map.getSize()`、`fg.getBounds()`：`map.getSize()` x 或 y 为 0 → 确认根因 1；`fg.getLayers().length===0` 但 `geoLayer.getLayers().length>0` → addLayer 时机问题。
4. Console 在 [POIEditor.tsx#L203](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/frontend/src/components/admin/POIEditor.tsx#L203) `invalidateSize` 回调里手动调 `map.fitBounds(fg.getBounds(), { padding: [40, 40] })`，若多边形出现则确认根因 1。
5. 弹窗打开瞬间 Console 打印 `poi`（prop 值），确认是否 null（根因 3）。
6. 检查父组件是否传 `key={poi?.id}`——没传 key 且复用实例则根因 2 成立。

### 4.4 修复方向（文档记录，不在本方案执行）

基于最可能根因 1，推荐修复顺序：

1. **延迟加载 geojson 到 `invalidateSize` 之后**（首选）：
   ```tsx
   setTimeout(() => {
     if (mapRef.current) {
       mapRef.current.invalidateSize()
       if (poi?.area_geojson && !geojsonLoadedRef.current) {
         try {
           const geo = JSON.parse(poi.area_geojson)
           const geoLayer = L.geoJSON(geo)
           geoLayer.eachLayer((l) => featureGroupRef.current?.addLayer(l))
           geojsonLoadedRef.current = true
           if (featureGroupRef.current?.getLayers().length) {
             mapRef.current.fitBounds(featureGroupRef.current.getBounds(), { padding: [40, 40] })
           }
         } catch (e) { console.warn('geojson parse failed', e) }
       }
     }
   }, 100)
   ```
2. **`useEffect` 依赖加 `poi?.id`**（治根因 3）：依赖数组 `[]` → `[poi?.id]`，POI 切换时重新执行加载；cleanup 里重置 `geojsonLoadedRef.current = false`。
3. **父组件传 `key={poi?.id}`**（治根因 2）：强制 POI 切换时组件卸载重建，避免 ref 残留。
4. **catch 块改 `console.warn`**（治根因 4）：暴露解析错误。
5. **保存时校验 Polygon 闭合**：首尾顶点不同则自动补闭合点，防解析失败。

---

## 5. 风险与对策

1. **配额滥用**：方向只给 8/16 方位、距离只给区间，反三角定位不可行；积分二次约束（移动方向 10次×5=50分，加其他逼近归零）；后端严格校验配额与积分，超限 403。
2. **归零体验断崖**：自动救济（B/C）不扣分且归零后仍触发兜底；前端积分 ≤20 红色警示"机会即将用完，请谨慎使用"；观察归零率必要时调初始积分或单次扣分。
3. **PK 公平争议**：移动强化是补偿固有劣势非特权，PC 操作层仍占优；按设备分桶统计 PK 胜率，差异过大时微调。
4. **bbox 边缘误判**：游戏只需粗粒度提示，误判影响小；必要时用 regeo 修正。
5. **前台不显示范围致困惑**：未命中 `distance_hint` 照常返回；命中 `target_summary` 可补"目标是一片区域"（可选）。
6. **开局图片剧透**：按难度分级模糊（简单 blur 4px/困难 blur 10px），命中解除；PC 3 秒后消失靠记忆（弱化剧透），移动常驻小图但模糊（强化不泄底）；观察命中率调整模糊度。
7. **`target_cover` 下发剧透**：双端都下发（PC 需展示 3 秒）无法按端屏蔽；关键信息（名称、坐标）不下发，封面图只是视觉钩子；若需更强防爬可对 URL 临时签名（有效期 3 秒）。
8. **A 救济"屏幕中心变化方向"**：需后端记录上次 `updateView` 快照。对策：`game_records` 加 `prev_view_lng/lat`，或 Redis 短期缓存。
9. **device 篡改**：关键阈值后端按 `game_records.device` 判定，前端无法绕过；若需更强校验后端结合 UA 二次验证。
10. **多边形 bug 修复影响保存逻辑**：`POIEditor.tsx` 序列化（L433-L446）与加载（L186-L200）需同步测试，避免改加载破坏保存。

---

## 6. 落地顺序

1. **P0**：
   - 后端：`game_records` 加 `device`+`hint_credits`(初始100) 字段；`start_game` 接收存储 device、初始化 hint_credits；`get_hint` 按端返回不同配额与扣分（简单 PC 3次×10/移动 10次×5），扣减 hint_credits 不足 403；`check_view` 响应补 `distance_bucket`（按端不同阈值）；新增 `location-hint` 接口（bbox 反查，按端不同时间阈值）；改造 `_calc_score` 移除原 level3/4 扣分改为 `剩余积分×0.5`。
   - 前端：简单模式移除黄色矩形、方向提示气泡、剩余次数与积分显示（⚡ XX/100）；困难 B 自动 3 秒方向 toast（按端阈值）；困难 C 时间过半/80% 自动省/市提示（按端阈值与展示形式）；提示按钮标注单次消耗；403 时 toast。
   - 前台显示：`renderTargetShape` 对 polygon/circle 只画中心点。
2. **P1**：
   - 后台：修复 `POIEditor.tsx` 多边形回显 bug；POI 列表行展开范围缩略图。
   - 困难 A 救济（新增 `bearing-hint` 接口，按端配额 PC 1/移动 2，超限 403）。
   - 双端开局图片（3 秒大图，按难度分级模糊；PC 消失/移动缩小常驻）+ 移动 16 方位/精细区间 + 提示信息密度优化。
3. **P2**：
   - 配额微调（按运营数据）。
   - 移动端 bug 修复（待复现）。
   - bbox → regeo 边缘修正（可选）。
   - PK 设备分桶胜率监控与阈值微调。

---

## 7. 关联文档

- [hard-mode-control-ux.md](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/docs/hard-mode-control-ux.md) — 困难模式操作栏，本方案"操作"层由它负责，本文只管"提示"层。
- [hard-mode-difficulty-reflection.md](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/docs/hard-mode-difficulty-reflection.md) — 难度矩阵，本方案"自动救济"对应其 6.2 节"可选救济"。
- [newbie-onboarding-analysis.md](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/docs/newbie-onboarding-analysis.md) — 新手门槛，本方案"简单模式方向提示"对应其 4.5 节"新手档提示"。
- [history/admin-and-ugc-plan.md](file:///Users/luanpeng/Desktop/allData/code/zhizhang/map/docs/history/admin-and-ugc-plan.md) — 区域判定原始方案，本方案"前台不显示/后台显示"是对其 3.5 节"前端胜利判断机制优化"的修订。

---

*本文档为设计思考与方案，不涉及代码改动。具体实现待方案确认后另起 issue / PR。*
