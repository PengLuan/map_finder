# Game.tsx / PKGame.tsx 重构设计文档

## 一、现状分析

### 1.1 文件概况

| 文件 | 行数 | 用途 |
|------|------|------|
| Game.tsx | ~1700 行 | 单人模式（自由对战） |
| PKGame.tsx | ~1500 行 | PK 模式（好友对战） |

### 1.2 重复代码统计

两个文件中 **约 60% 的代码是重复的**，主要重复区域：

| 重复区域 | Game.tsx 行号 | PKGame.tsx 行号 | 重复度 |
|----------|-------------|-----------------|--------|
| 常量定义 | L28-100 | L20-94 | 98%（仅 Game 多 QUICK_DISTANCES） |
| addTileLayers 函数 | L107-145 | L96-127 | 100% |
| 地图初始化 | L450-490 | L426-468 | 90%（差异：api 调用、difficulty 来源） |
| 巡航循环 cruiseLoop | L687-734 | L572-619 | 95%（差异：api 调用、win 回调） |
| startCruise | L784-828 | L676-724 | 95%（差异：difficulty 来源） |
| stopCruise | L736-783 | L621-674 | 95%（差异：syncAndCheck 实现） |
| speedUp | L830-850 | L726-750 | 95% |
| handleCruiseClick | L852-861 | 不存在（PK 用内联） | - |
| 键盘巡航 | L863-926 | L763-826 | 95% |
| 距离跳转 | L928-957 | L828-880 | 90% |
| 边缘 8 方向按钮 JSX | L1384-1391 | L1112-1120 | 100% |
| 中心仪表盘 JSX | L1392-1430 | L1170-1200 | 95% |
| 标注层/zoomRestoring 管理 | 散布各处 | 散布各处 | 100% |

### 1.3 核心差异点

#### 差异 A：API 层
```
Game.tsx:  api.startGame() / api.move() / api.checkView() / api.clickTarget() / api.getHint() / api.giveUp()
PKGame.tsx: pkApi.getGameState() / pkApi.move() / pkApi.checkView() / pkApi.clickTarget() / pkApi.getHint() / pkApi.giveUp() / pkApi.rematch()
```

#### 差异 B：类型层
```
Game.tsx:  StartResponse / HintResponse / CheckViewResponse / SelectResponse / GiveUpResponse
PKGame.tsx: PKStartResponse / PKHintResponse / PKCheckViewResponse / PKGameState
```

#### 差异 C：游戏初始化
- Game: `api.startGame(mode, regionCode, difficulty, category, device)` → StartResponse
- PK: `pkApi.getGameState(gameId)` → PKGameState（含对手信息）

#### 差异 D：提示系统（困难模式）
- Game: 有 B 救济（distance_bucket toast）、C 救济（省/市对比）、hint_credits 积分系统、locationHint
- PK: 仅基础 hint（bounds 矩形），无 B/C 救济，无积分系统

#### 差异 E：结算面板
- Game: 单人结算（得分、距离、用时、步数、目标信息）
- PK: 对战结算（双方得分对比、胜负、rematch 再来一局）

#### 差异 F：PK 独有功能
- 对手信息（昵称、分数、命中状态）
- 对手离开检测与倒计时
- 轮询 usePolling + 心跳 useHeartbeat
- rematch 再来一局

---

## 二、重构目标

1. **消除重复**：将 ~60% 重复代码抽取为共享模块
2. **功能完全一致**：重构后行为与现有代码 100% 一致
3. **三个核心模块**：
   - 交互地图基础（InteractiveMapBase）
   - 简单模式逻辑与 UI（EasyModePanel）
   - 困难模式逻辑与 UI（HardModePanel）
4. **可扩展性**：未来新增模式或变体只需写新的 Panel

---

## 三、架构设计

### 3.1 整体架构图

```
Game.tsx (单人)                    PKGame.tsx (对战)
    │                                  │
    │ 创建 soloApiAdapter              │ 创建 pkApiAdapter
    │                                  │
    └──────────┬───────────────────────┘
               │
               ▼
    ┌──────────────────────────┐
    │   InteractiveMapBase     │  ← 交互地图基础
    │   (地图容器 + 瓦片 + 事件)  │
    │                          │
    │   内部使用：              │
    │   - useCruiseSystem()    │  ← 巡航 Hook
    │   - useTrailSystem()     │  ← 轨迹 Hook
    │   - useZoomManager()     │  ← 缩放/标注层管理
    │                          │
    │   children 插槽：         │
    │   ├─ EasyModePanel       │  ← 简单模式
    │   └─ HardModePanel       │  ← 困难模式
    └──────────────────────────┘
               │
               ▼
    ┌──────────────────────────┐
    │   GameResultPanel        │  ← 结算面板（可配置 solo/pk）
    └──────────────────────────┘
```

### 3.2 文件结构

```
frontend/src/
├── pages/
│   ├── Game.tsx              ← 单人入口（薄包装，~200行）
│   └── PKGame.tsx            ← PK入口（薄包装 + PK独有逻辑，~300行）
├── game/
│   ├── base/
│   │   ├── constants.ts      ← 共享常量（DIRECTIONS, CRUISE_SPEEDS 等）
│   │   ├── tileLayers.ts     ← addTileLayers + TILE_SOURCE 配置
│   │   ├── types.ts          ← GameApiAdapter 接口 + 通用类型
│   │   ├── InteractiveMapBase.tsx   ← 地图基础组件
│   │   ├── useCruiseSystem.ts ← 巡航系统 Hook
│   │   ├── useTrailSystem.ts  ← 轨迹系统 Hook
│   │   └── useZoomManager.ts  ← 缩放/标注层管理 Hook
│   ├── easy/
│   │   ├── EasyModePanel.tsx  ← 简单模式面板（点击落点、确认、方向提示）
│   │   └── usePickSystem.ts   ← 落点标记 Hook
│   ├── hard/
│   │   ├── HardModePanel.tsx  ← 困难模式面板（边缘按钮、仪表盘、距离跳转）
│   │   ├── CruiseDashboard.tsx ← 中心仪表盘组件
│   │   ├── EdgeDirButtons.tsx  ← 边缘8方向按钮组件
│   │   └── useHintSystem.ts    ← 提示/救济系统 Hook（B救济/C救济/hintCredits）
│   ├── shared/
│   │   ├── GameResultPanel.tsx ← 结算面板（solo/pk 可配置）
│   │   ├── CoverImage.tsx      ← 开局封面图组件
│   │   └── GuideModal.tsx     ← 玩法引导弹窗
│   └── adapters/
│       ├── soloApiAdapter.ts  ← 单人 API 适配器
│       └── pkApiAdapter.ts     ← PK API 适配器
```

### 3.3 核心接口设计

#### 3.3.1 GameApiAdapter（API 适配器接口）

```typescript
// game/base/types.ts

/** 统一的游戏 API 接口，屏蔽 solo/pk 差异 */
interface GameApiAdapter {
  /** 移动视角 */
  move(gameId: number, direction: string, distanceKm: number): Promise<MoveResult>
  /** 同步视角到服务端 */
  updateView(gameId: number, lng: number, lat: number): Promise<void>
  /** 困难模式视野判定 */
  checkView(gameId: number, west: number, south: number, east: number, north: number): Promise<CheckViewResult>
  /** 简单模式点击落点判定 */
  clickTarget(gameId: number, lng: number, lat: number): Promise<ClickResult>
  /** 使用提示 */
  getHint(gameId: number, hintLevel: number): Promise<HintResult>
  /** 放弃 */
  giveUp(gameId: number): Promise<GiveUpResult>
}

/** 统一移动结果 */
interface MoveResult {
  view_lng: number
  view_lat: number
  steps?: number       // solo 有，pk 无
  total_distance_km?: number  // solo 有，pk 无
}

/** 统一视野判定结果 */
interface CheckViewResult {
  hit: boolean
  distance_bucket?: string
  score?: number
  target_name?: string
  target_lng?: number
  target_lat?: number
  target_summary?: string | null
  target_cover?: string | null
  duration_sec?: number
  target_shape?: TargetShape | null
  contributor_nickname?: string | null
}

// ... 其他接口类似
```

#### 3.3.2 InteractiveMapBase Props

```typescript
// game/base/InteractiveMapBase.tsx

interface InteractiveMapBaseProps {
  // 游戏基础数据
  gameId: number
  mode: string
  difficulty: 'easy' | 'hard'
  startLng: number
  startLat: number

  // API 适配器
  apiAdapter: GameApiAdapter

  // 回调
  onWin: (result: CheckViewResult) => void      // 命中胜利
  onCheckView?: (result: CheckViewResult) => void  // 非命中结果（B救济等）
  onMapReady?: (map: L.Map) => void

  // 子组件插槽
  children?: React.ReactNode  // EasyModePanel 或 HardModePanel

  // 状态注入（由父组件控制）
  ended: boolean
  isMobile: boolean
}
```

#### 3.3.3 useCruiseSystem Hook

```typescript
// game/base/useCruiseSystem.ts

interface CruiseSystemParams {
  map: L.Map | null
  gameId: number | null
  difficulty: string
  apiAdapter: GameApiAdapter
  onWin: (result: CheckViewResult) => void
  onCheckView?: (result: CheckViewResult) => void
  isMobile: boolean
  ended: boolean
  showToast: (msg: string) => void
  cruiseSpeeds: number[]
  jumpDistances: number[]
  setTotalDist: (updater: (prev: number) => number) => void
}

interface CruiseSystemReturn {
  // 状态
  cruiseDir: string | null
  cruiseSpeed: number
  cruiseDist: number
  cruiseZoomed: boolean
  // 控制
  startCruise: (dir: string) => void
  stopCruise: () => void
  speedUp: () => void
  handleCruiseClick: (dir: string) => void
  jumpDistance: (km: number) => void
}
```

#### 3.3.4 EasyModePanel Props

```typescript
// game/easy/EasyModePanel.tsx

interface EasyModePanelProps {
  map: L.Map | null
  gameId: number | null
  apiAdapter: GameApiAdapter
  ended: boolean
  onWin: (result: ClickResult) => void
  onMiss: (msg: string) => void
  // 简单模式提示
  easyDirHint: string | null
  hintCredits: number
  hintCost: number
  onUseHint: () => void
}
```

#### 3.3.5 HardModePanel Props

```typescript
// game/hard/HardModePanel.tsx

interface HardModePanelProps {
  map: L.Map | null
  gameId: number | null
  apiAdapter: GameApiAdapter
  ended: boolean
  difficulty: string
  mode: string  // national/provincial/city，影响提示文案
  isMobile: boolean
  // 巡航系统（由 InteractiveMapBase 注入）
  cruise: CruiseSystemReturn
  // 提示/救济系统
  hintSystem: HintSystemReturn
  // 回调
  onGiveUp: () => void
  showToast: (msg: string) => void
}
```

---

## 四、模块详细设计

### 4.1 交互地图基础（InteractiveMapBase）

**职责**：地图容器创建、瓦片加载、moveend 事件、轨迹渲染、缩放管理

**内部组合**：
1. `useZoomManager(map, difficulty)` — 标注层引用、zoomRestoringRef、巡航降级时移除/恢复标注层
2. `useTrailSystem(map)` — 轨迹 polyline 创建、更新、淡出
3. `useCruiseSystem(...)` — 巡航循环、startCruise/stopCruise/speedUp、键盘控制

**moveend 处理逻辑**（与现有完全一致）：
```
if (!id || ended || zoomRestoring) return
if (cruiseActive) return
updateView(lng, lat)
if (easy) return
checkView(bounds) → onCheckView/onWin
```

**syncAndCheck 处理逻辑**（巡航循环节流调用）：
```
if (!id || ended) return
updateView(lng, lat)          // 始终同步位置
if (zoomRestoring || cruiseActive) return  // 巡航中/恢复中不判定视野
checkView(bounds) → onCheckView/onWin      // 只有停下来才判定
```

**渲染**：
```tsx
<div ref={mapContainerRef} className="absolute inset-0" />
{children}  {/* EasyModePanel 或 HardModePanel */}
```

### 4.2 简单模式（EasyModePanel）

**职责**：点击放置落点标记、确认提交、方向提示、缩放控件

**内部组合**：
1. `usePickSystem(map)` — 落点 marker 创建、拖拽、setPicked
2. 确认按钮 → `apiAdapter.clickTarget()`
3. 方向提示气泡（easyDirHint）
4. 缩放控件 `L.control.zoom()`

**JSX 结构**（与现有完全一致）：
- 右侧控制面板（距离输入、移动按钮、快捷距离）
- 确认落点按钮（底部居中）
- 方向提示气泡

### 4.3 困难模式（HardModePanel）

**职责**：8 方向巡航按钮、中心仪表盘、提示/救济系统、距离跳转

**内部组合**：
1. `useHintSystem(map, gameId, apiAdapter)` — hint credits、B 救济、C 救济、方向提示、区域提示
2. `CruiseDashboard` 组件 — 速度/方向/距离显示、停止按钮
3. `EdgeDirButtons` 组件 — 8 方向贴边按钮
4. 距离跳转按钮组

**JSX 结构**（与现有完全一致）：
- 边缘 8 方向按钮
- 中心仪表盘（速度/方向/停止/距离跳转）
- 提示面板（方向提示、区域提示、B救济toast、C救济省市）
- 放弃按钮

### 4.4 结算面板（GameResultPanel）

**配置化设计**：
```typescript
interface GameResultPanelProps {
  variant: 'solo' | 'pk'
  // 通用
  hit: boolean
  targetName: string
  targetCover: string | null
  targetSummary: string | null
  targetLng: number
  targetLat: number
  targetShape?: TargetShape | null
  contributorNickname?: string | null
  // solo 独有
  score?: number
  durationSec?: number
  steps?: number
  totalDistanceKm?: number
  // pk 独有
  myScore?: number
  opponentScore?: number
  opponentNickname?: string
  winner?: string | null
  winReason?: string | null
  // 操作
  onNewGame: () => void
  onLeave: () => void
  rematchRequested?: boolean
  onRematch?: () => void
}
```

### 4.5 API 适配器

#### soloApiAdapter
```typescript
// game/adapters/soloApiAdapter.ts
const soloApiAdapter: GameApiAdapter = {
  move: (gid, dir, km) => api.move(gid, dir, km),
  updateView: (gid, lng, lat) => api.updateView(gid, lng, lat),
  checkView: (gid, w, s, e, n) => api.checkView(gid, w, s, e, n),
  clickTarget: (gid, lng, lat) => api.clickTarget(gid, lng, lat),
  getHint: (gid, level) => api.getHint(gid, level),
  giveUp: (gid) => api.giveUp(gid),
}
```

#### pkApiAdapter
```typescript
// game/adapters/pkApiAdapter.ts
const pkApiAdapter: GameApiAdapter = {
  move: (gid, dir, km) => pkApi.move(gid, dir, km),
  updateView: (gid, lng, lat) => pkApi.updateView(gid, lng, lat),
  checkView: (gid, w, s, e, n) => pkApi.checkView(gid, w, s, e, n),
  clickTarget: (gid, lng, lat) => pkApi.clickTarget(gid, lng, lat),
  getHint: (gid, level) => pkApi.getHint(gid, level),
  giveUp: (gid) => pkApi.giveUp(gid),
}
```

---

## 五、重构后的 Game.tsx / PKGame.tsx 结构

### 5.1 Game.tsx（单人，~200行）

```typescript
export default function Game({ mode, regionCode, difficulty, category, onBack }: Props) {
  const isMobile = detectIsMobileEnv()
  const [game, setGame] = useState<StartResponse | null>(null)
  const [result, setResult] = useState<SelectResponse | null>(null)
  const [showResult, setShowResult] = useState(false)
  const [ended, setEnded] = useState(false)
  // ... 其他 solo 独有状态（hintCredits, reliefMsg 等）

  // 1. 开始游戏
  useEffect(() => {
    api.startGame(...).then(res => setGame(res))
  }, [...])

  // 2. 处理胜利
  const handleWin = useCallback((res) => {
    setEnded(true)
    setResult(res)
    setShowResult(true)
    // 保存游戏记录
    saveGameRecord(...)
  }, [...])

  // 3. 渲染
  if (!game) return <Loading />
  return (
    <InteractiveMapBase
      gameId={game.game_id}
      mode={mode}
      difficulty={difficulty}
      startLng={game.start_lng}
      startLat={game.start_lat}
      apiAdapter={soloApiAdapter}
      onWin={handleWin}
      onCheckView={handleCheckView}  // B救济等
      ended={ended}
      isMobile={isMobile}
    >
      {difficulty === 'easy' ? (
        <EasyModePanel ... />
      ) : (
        <HardModePanel ... />
      )}
      {/* 封面图、引导弹窗等共享 UI */}
      <CoverImage ... />
      <GuideModal ... />
      {showResult && <GameResultPanel variant="solo" ... />}
    </InteractiveMapBase>
  )
}
```

### 5.2 PKGame.tsx（对战，~350行）

```typescript
export default function PKGame({ gameId, roomId, onLeave, onNewGame, startCover }: Props) {
  const isMobile = detectIsMobileEnv()
  const [state, setState] = useState<PKGameState | null>(null)
  const [result, setResult] = useState<PKCheckViewResponse | null>(null)
  const [showResult, setShowResult] = useState(false)
  const [ended, setEnded] = useState(false)
  // ... PK 独有状态（opponent, rematch 等）

  // 1. 轮询游戏状态
  usePolling(...)
  useHeartbeat(...)

  // 2. 获取游戏状态
  useEffect(() => {
    pkApi.getGameState(gameId).then(setState)
  }, [gameId])

  // 3. 处理胜利
  const handleWin = useCallback((res) => {
    setEnded(true)
    setResult(res)
    setShowResult(true)
  }, [...])

  // 4. 对手离开处理（PK 独有）
  useEffect(() => { ... }, [state?.opponent_left])

  // 5. 渲染
  if (!state) return <Loading />
  return (
    <>
      {/* PK 独有：顶部 VS 信息栏 */}
      <PKTopBar state={state} />

      <InteractiveMapBase
        gameId={gameId}
        mode={state.mode}
        difficulty={state.difficulty}
        startLng={state.my_view_lng}
        startLat={state.my_view_lat}
        apiAdapter={pkApiAdapter}
        onWin={handleWin}
        onCheckView={handleCheckView}
        ended={ended}
        isMobile={isMobile}
      >
        {state.difficulty === 'easy' ? (
          <EasyModePanel ... />
        ) : (
          <HardModePanel ... />
        )}
        <CoverImage ... />
        <GuideModal ... />
        {showResult && <GameResultPanel variant="pk" ... />}
      </InteractiveMapBase>
    </>
  )
}
```

---

## 六、重构步骤（安全渐进式）

### 第一阶段：抽取共享常量和工具（低风险）
1. 创建 `game/base/constants.ts` — 移动所有共享常量
2. 创建 `game/base/tileLayers.ts` — 移动 addTileLayers + TILE_SOURCE
3. Game.tsx 和 PKGame.tsx 改为从新模块导入
4. **验证**：构建 + 功能测试，确保行为不变

### 第二阶段：创建 API 适配器（低风险）
1. 创建 `game/base/types.ts` — 定义 GameApiAdapter 接口
2. 创建 `game/adapters/soloApiAdapter.ts` 和 `pkApiAdapter.ts`
3. **验证**：类型检查通过

### 第三阶段：抽取巡航系统 Hook（中风险）
1. 创建 `game/base/useCruiseSystem.ts`
2. 从 Game.tsx 移动巡航逻辑（cruiseLoop, startCruise, stopCruise, speedUp, handleCruiseClick, keyboard, jumpDistance）
3. 从 PKGame.tsx 移动相同逻辑
4. 两个文件改用 `useCruiseSystem(...)` Hook
5. **验证**：构建 + 巡航功能测试（方向切换、速度变化、zoom降级恢复、标注层隐藏恢复）

### 第四阶段：抽取缩放和轨迹管理 Hook（中风险）
1. 创建 `game/base/useZoomManager.ts`（labelLayerRef, zoomRestoringRef）
2. 创建 `game/base/useTrailSystem.ts`（trailRef, trailPointsRef, updateTrail, fadeTrail）
3. useCruiseSystem 依赖这两个 Hook
4. **验证**：构建 + 巡航中文字隐藏/恢复测试

### 第五阶段：创建 InteractiveMapBase 组件（中高风险）
1. 创建 `game/base/InteractiveMapBase.tsx`
2. 移动地图初始化、moveend 处理、click 处理（简单模式）
3. 接收 children 插槽
4. Game.tsx 和 PKGame.tsx 改用 InteractiveMapBase
5. **验证**：构建 + 全量功能测试（简单/困难、单人/PK）

### 第六阶段：抽取 EasyModePanel 和 HardModePanel（中高风险）
1. 创建 `game/easy/EasyModePanel.tsx` — 简单模式 UI 和逻辑
2. 创建 `game/hard/HardModePanel.tsx` — 困难模式 UI 和逻辑
3. 创建子组件 `CruiseDashboard.tsx`、`EdgeDirButtons.tsx`
4. 创建 `game/hard/useHintSystem.ts` — 提示/救济系统
5. InteractiveMapBase 的 children 改为这两个 Panel
6. **验证**：构建 + 全量功能测试

### 第七阶段：抽取结算面板和共享 UI（低风险）
1. 创建 `game/shared/GameResultPanel.tsx`
2. 创建 `game/shared/CoverImage.tsx`、`GuideModal.tsx`
3. **验证**：构建 + 结算面板测试

### 第八阶段：清理和瘦身（低风险）
1. 删除 Game.tsx 和 PKGame.tsx 中已抽取的死代码
2. 确认两个文件行数降至目标（Game ~200行，PKGame ~350行）
3. **最终验证**：全量回归测试

---

## 七、风险与缓解措施

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| useRef 闭包过期 | 高 | Hook 内部管理所有 ref，不通过 props 传递 ref |
| useCallback 依赖遗漏 | 高 | startCruise 依赖必须含 difficulty；每次抽取后运行 `npx tsc --noEmit` 检查 |
| 巡航 zoom 管理时序 | 高 | 保持现有 setMinZoom(3) → setZoom → zoomend 顺序；zoom in 时先降低 minZoom 再 setZoom |
| 标注层移除/恢复时序 | 中 | 保持先移除标注层再降级 zoom 的顺序；恢复时先 addLayer 再 setZoom |
| cleanup 未重置 ref | 高 | 地图销毁 cleanup 必须重置所有 layer/marker ref（pickMarkerRef、labelLayerRef、targetMarkerRef、hintRectRef、targetShapeLayerRef、trailRef、cruiseZoomReducedRef、cruiseOrigZoomRef），否则"再来一局"后旧 ref 指向已销毁 marker 导致水滴丢失 |
| 巡航中误判定视野 | 高 | syncAndCheck 中检查 cruiseActiveRef，巡航中只同步位置不判定视野；停下来才 checkView |
| PK 轮询与巡航竞态 | 中 | 保持 endedRef 检查在 cruiseLoop 首行 |
| 简单模式 click 事件冲突 | 中 | InteractiveMapBase 只绑定 moveend，click 绑定在 EasyModePanel |
| "再来一局"状态残留 | 中 | 重置 picked/submitting/所有救济 ref，配合 cleanup ref 重置 |

---

## 八、验证清单

每个阶段完成后需验证以下场景：

### 8.1 简单模式
- [ ] 点击地图放置落点标记
- [ ] 拖拽微调落点
- [ ] 确认提交判定（命中/未命中）
- [ ] 方向提示气泡
- [ ] 缩放控件正常
- [ ] 快捷距离按钮
- [ ] 距离输入移动
- [ ] 多局游戏后水滴标记不丢失（cleanup ref 重置验证）

### 8.2 困难模式
- [ ] 8 方向巡航按钮启动/加速/停止
- [ ] 键盘 WASD/qEZC 巡航
- [ ] Space 停止巡航
- [ ] Shift 精细模式
- [ ] 速度档位变化时 zoom 同步调整
- [ ] 切换方向时速度回到 1 档 + zoom 恢复（else if 分支 + setMinZoom(3) → setZoom → zoomend 顺序）
- [ ] 巡航时标注层（地名文字）隐藏
- [ ] 停止巡航后标注层恢复
- [ ] 放大恢复期间不触发结算
- [ ] 巡航中不判定视野（syncAndCheck 检查 cruiseActiveRef）
- [ ] 停止巡航后才判定视野
- [ ] B 救济 toast（快到了）
- [ ] C 救济（省/市对比）
- [ ] hint credits 积分扣减
- [ ] 距离跳转按钮

### 8.3 PK 模式
- [ ] 对手信息显示
- [ ] 对手离开检测与倒计时
- [ ] rematch 再来一局
- [ ] 轮询状态更新
- [ ] 结算面板双方得分对比

### 8.4 通用
- [ ] 开局封面图 3 秒大图 → PC 消失 / 移动缩略图
- [ ] 玩法引导弹窗（不再提示）
- [ ] 结算面板正确显示
- [ ] 再来一局重置所有状态
