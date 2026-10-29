# 游戏轨迹录制动画可行性讨论

## 一、背景与目标

### 1.1 背景

地图寻踪游戏当前的核心体验是"巡航探索 + 命中目标"。玩家通过 8 方向巡航按钮在地图上移动视野，寻找隐藏目标。当前已有青色 Polyline 实时绘制巡航轨迹（[Game.tsx:648-657](../frontend/src/pages/Game.tsx#L648-L657)），但轨迹仅在巡航过程中临时显示，停止巡航后淡出消失，不保留、不回放。

玩家完成一局后，结算面板只展示静态数据（分数、用时、步数、距离）。缺少对"探索过程"的视觉化回顾，玩家无法感受自己走过的旅程。

### 1.2 目标

将玩家在一局游戏中的视野移动轨迹录制下来，在结算时以动画形式回放，让玩家直观看到自己的探索路径、转向、徘徊、最终命中位置，增强"旅程感"和成就感。

---

## 二、现状分析

### 2.1 当前轨迹实现

| 维度 | 现状 |
|---|---|
| 数据采集 | 仅巡航时记录：`trailPointsRef.current.push(map.getCenter())` |
| 采样频率 | requestAnimationFrame 每帧（约 60fps，但受 dt 限制） |
| 点数上限 | 300 个点（超过则 shift 丢弃旧点） |
| 持久化 | 无，仅存在 useRef，页面刷新即丢失 |
| 拖拽轨迹 | 未记录（拖拽走 updateView，不进 trailPointsRef） |
| 方向按钮轨迹 | 未记录（moveView 接口不进 cruiseLoop） |
| 可视化 | Leaflet Polyline，青色 3px，实时绘制 |
| 生命周期 | 停止巡航即 `fadeTrail()` 淡出消失 |

### 2.2 现状问题

1. **数据不完整**：只记录巡航轨迹，拖拽和方向按钮移动的轨迹丢失
2. **点数截断**：300 点上限，长对局后期轨迹被丢弃
3. **无持久化**：结算后轨迹消失，无法复盘
4. **无时间维度**：只有坐标点，没有时间戳，无法还原节奏

---

## 三、技术方案

### 3.1 数据采集层

在现有 `trailPointsRef` 基础上，新增统一的"轨迹录制器"，覆盖所有视野移动方式：

```typescript
interface TrajectoryPoint {
  lng: number
  lat: number
  t: number  // 相对开局的毫秒时间戳
  action: 'cruise' | 'drag' | 'move' | 'start' | 'hit'  // 移动方式
}

interface TrajectoryRecorder {
  points: TrajectoryPoint[]
  start(lng: number, lat: number): void
  record(lng: number, lat: number, action: TrajectoryPoint['action']): void
  finish(lng: number, lat: number): TrajectoryPoint[]
}
```

**采集点改造**：
- 巡航：`cruiseLoop` 每帧 push（已有，补 t 和 action）
- 拖拽：`moveend` 事件 handler 中 push
- 方向按钮：`handleMove` 回调成功后 push
- 开局：`start_game` 后 push 起点
- 命中：`handleWin` 中 push 终点

**采样策略**（控制点数）：
- 距离过滤：相邻两点 < 50m 不记录（避免静止抖动）
- 时间过滤：最快 100ms 采样一次（避免高频冗余）
- 预估点数：全国模式 300 秒 × 5点/秒 ≈ 1500 点，省市模式 ≈ 900 点

### 3.2 数据存储层

**方案 A：仅前端 localStorage（轻量）**
- 轨迹 JSON 随 `saveGameRecord` 一起存入 localStorage
- 优点：零后端改动，立即可用
- 缺点：localStorage 容量限制（5MB），轨迹数据膨胀，只保留最近 20 局可能超限
- 预估大小：1500 点 × 40 字节 ≈ 60KB/局，20 局约 1.2MB，可接受

**方案 B：后端持久化（完整）**
- 新增 `game_trajectories` 表：`game_id, points_json, duration_ms`
- 结算时上传轨迹，复盘时拉取
- 优点：不占 localStorage，可跨设备复盘，可做全局"热门轨迹"统计
- 缺点：后端改动，增加表和接口

**推荐：先做方案 A 验证体验，再视情况升级方案 B。**

### 3.3 动画回放层

#### 3.3.1 回放容器

在结算面板新增"轨迹回放"区域，或独立弹窗：

```
┌─────────────────────────────┐
│  🗺️ 探索轨迹回放            │
│  ┌─────────────────────────┐ │
│  │                         │ │
│  │    [Leaflet 地图]       │ │
│  │    起点 → 曲线 → 终点🎯 │ │
│  │                         │ │
│  └─────────────────────────┘ │
│  ▶ 播放  ⏸ 暂停  ⏭ 跳到命中 │
│  ━━━━━━━━━━━━━━━━━━ 00:45/02:30│
│  速度: 1x  2x  4x  8x       │
└─────────────────────────────┘
```

#### 3.3.2 回放算法

```typescript
function playTrajectory(map: L.Map, points: TrajectoryPoint[], speed: number) {
  const totalMs = points[points.length - 1].t
  let elapsed = 0
  let idx = 0

  const step = (ts: number) => {
    elapsed += (ts - lastTs) * speed
    while (idx < points.length && points[idx].t <= elapsed) {
      idx++
    }
    // 更新地图中心到当前点
    map.panTo([points[idx].lat, points[idx].lng], { animate: false })
    // 更新轨迹已走部分的 Polyline
    trailLayer.setLatLngs(points.slice(0, idx))
    // 更新进度条
    setProgress(elapsed / totalMs)
    if (elapsed < totalMs) {
      rafId = requestAnimationFrame(step)
    } else {
      onFinished()
    }
  }
  rafId = requestAnimationFrame(step)
}
```

#### 3.3.3 视觉增强

- **起点标记**：绿色水滴图标 + "起点"标签
- **终点标记**：红色水滴图标 + 🎯（命中）/ 白旗（放弃）
- **轨迹渐变**：按时间渐变颜色（起点青色 → 终点琥珀色），体现"旅程推进"
- **移动光标**：一个跟随轨迹移动的小图标（如飞机 ✈️ 或水滴），增强动感
- **关键时刻高亮**：提示使用点、转向点、徘徊区域用脉冲圆圈标记
- **加速回放**：默认 4x（3 分钟对局 45 秒看完），可选 1x/2x/4x/8x

---

## 四、可行性分析

### 4.1 技术可行性

| 维度 | 评估 | 说明 |
|---|---|---|
| 数据采集 | ✅ 高 | 已有 trailPointsRef 基础，扩展即可 |
| Leaflet 动画 | ✅ 高 | `panTo` + `setLatLngs` 已验证可用 |
| localStorage 存储 | ⚠️ 中 | 单局 60KB 可控，但需监控总量 |
| 性能 | ⚠️ 中 | 1500 点 Polyline 渲染无压力，但回放时 60fps panTo 可能在低端机卡顿 |

### 4.2 性能风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 1500 点 Polyline | 低 | Leaflet 原生支持万级点，1500 点无压力 |
| 回放 60fps panTo | 中 | 降帧到 30fps，或用 `setView` 替代 `panTo` |
| localStorage 膨胀 | 中 | 轨迹压缩（只存 [lng,lat,t] 三元组，不存 key 名），或后端存储 |
| 长对局点数过多 | 低 | 动态降采样：超过 2000 点时按距离合并相邻点 |

### 4.3 用户体验可行性

| 维度 | 评估 |
|---|---|
| 旅程感增强 | ✅ 高，可视化路径比纯数字更有沉浸感 |
| 复盘价值 | ✅ 高，玩家可看到"在哪里徘徊""提示后转向哪里" |
| 分享价值 | ✅ 高，可截图/录屏分享"我的探索路径" |
| 时间成本 | ⚠️ 3 分钟对局回放 45 秒（4x），玩家是否愿意看？需默认折叠，点击展开 |

---

## 五、优缺点

### 5.1 优点

1. **增强旅程感**：将抽象的"移动距离 350km"转化为可视化的路径，让玩家"看到"自己的探索
2. **复盘学习**：玩家可发现"我在这里绕远了""提示后方向对了"，提升游戏技巧
3. **社交分享**：轨迹截图/动图可分享，自带传播属性
4. **数据完整性**：补全拖拽和方向按钮的轨迹，当前只录巡航是数据缺失
5. **复用现有基础设施**：已有 trailPointsRef、Polyline、Leaflet，增量改造成本低

### 5.2 缺点

1. **存储成本**：每局增加 60KB，localStorage 20 局约 1.2MB，接近 localStorage 友好上限
2. **开发成本**：前端需新增录制器、回放组件、进度控制，约 2-3 个工作日
3. **低端机性能**：回放时 60fps panTo 在老旧手机上可能卡顿，需降帧
4. **玩家注意力**：部分玩家只想快速再来一局，回放可能被跳过——需设计为可选
5. **隐私顾虑**：轨迹含精确坐标序列，若后端存储需考虑玩家隐私

---

## 六、实施建议

### 6.1 分阶段实施

**阶段一（最小可用，验证体验）**：
- 扩展 `trailPointsRef` 为 `TrajectoryPoint[]`，补全拖拽和方向按钮采集
- 结算面板新增"▶ 回放轨迹"按钮（默认折叠）
- 回放复用现有 Leaflet 地图，4x 速度，无进度条
- 轨迹随 `saveGameRecord` 存入 localStorage
- 工作量：约 1 天

**阶段二（体验优化）**：
- 新增独立回放弹窗，带进度条、速度切换、暂停
- 轨迹渐变色 + 移动光标
- 关键时刻（提示使用、转向）高亮标记
- 工作量：约 1-2 天

**阶段三（社交化，可选）**：
- 后端持久化轨迹（方案 B）
- 轨迹截图/动图导出
- "热门轨迹"排行榜
- 工作量：约 3-5 天

### 6.2 与 Bug 1 修复的协同

本次 Bug 1 修复已让后端 `update_view` 累加 `total_distance_km`。轨迹录制可复用 `update_view` 的调用时机采集拖拽点，无需额外接口。

### 6.3 兼容性

- 旧 localStorage 记录无轨迹数据，回放按钮对旧记录显示"无轨迹数据"
- 新记录开始采集，不破坏现有 `GameRecordItem` 结构（新增可选 `trajectory` 字段）

---

## 七、结论

**轨迹录制动画技术可行、体验价值高、增量成本可控**。推荐分阶段实施：

1. **立即做**：阶段一（最小可用），验证玩家是否喜欢回放
2. **视反馈做**：阶段二（体验优化），如果玩家反馈喜欢
3. **远期做**：阶段三（社交化），如果有传播需求

核心价值：把"数字 350km"变成"一段看得见的旅程"，让地图寻踪从"找目标"升级为"记录探索"。

---

## 附录：关键代码位置

- 当前轨迹采集：[Game.tsx:707-708](../frontend/src/pages/Game.tsx#L707-L708)
- 当前轨迹绘制：[Game.tsx:648-657](../frontend/src/pages/Game.tsx#L648-L657)
- 当前轨迹淡出：[Game.tsx:660-678](../frontend/src/pages/Game.tsx#L660-L678)
- 游戏记录存储：[gameRecords.ts](../frontend/src/utils/gameRecords.ts)
- 后端 update_view（Bug 1 修复点）：[game.py:282-302](../backend/app/services/game.py#L282-L302)
