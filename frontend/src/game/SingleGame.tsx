/**
 * SingleGame — 通用单局游戏组件
 *
 * 使用 useSingleGame hook 管理游戏状态，渲染地图+面板+结算。
 * solo 模式：内置结算面板 + "再来一局"
 * collection 模式：onGameEnd 回调通知父组件（Collection.tsx）
 */
import {
  creditsTextClass,
  hintCostText,
} from '../utils/hint'
import { InteractiveMapBase } from './base/InteractiveMapBase'
import { soloApiAdapter } from './adapters/soloApiAdapter'
import { EasyModePanel } from './easy/EasyModePanel'
import { HardModePanel } from './hard/HardModePanel'
import { CoverImage } from './shared/CoverImage'
import { GuideModal } from './shared/GuideModal'
import { GameResultPanel } from './shared/GameResultPanel'
import { useSingleGame } from './useSingleGame'
import type { GameEndResult } from './useSingleGame'
import type { StartResponse } from '../types'
import type { GameApiAdapter } from './base/types'

interface SingleGameProps {
  startFn: (startLng?: number, startLat?: number) => Promise<StartResponse>
  difficulty: string
  mode: string
  onGameEnd?: (result: GameEndResult) => void
  onBack: () => void
  gameKey: number | string
  variant?: 'solo' | 'collection'
  /** 专题模式：顶部标题文案 */
  title?: string
  /** 初始 zoom（点选专题模式新局继承上一局比例） */
  initZoom?: number
  /** 自定义 API 适配器（新闻等模式复用引擎时传入；默认走 /api/game） */
  apiAdapter?: GameApiAdapter
}

export function SingleGame({
  startFn,
  difficulty,
  mode,
  onGameEnd,
  onBack,
  gameKey,
  variant = 'solo',
  title,
  initZoom: propInitZoom,
  apiAdapter: externalAdapter,
}: SingleGameProps) {
  const apiAdapter = externalAdapter ?? soloApiAdapter
  const sg = useSingleGame({
    startFn,
    difficulty,
    mode,
    apiAdapter,
    onGameEnd,
    variant,
    reportSession: variant === 'solo',
    gameKey,
  })

  if (sg.error && !sg.game) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-900">
        <div className="text-center">
          <p className="text-red-400 mb-4">{sg.error}</p>
          <button onClick={onBack} className="px-6 py-2 bg-slate-700 rounded-lg hover:bg-slate-600">
            返回
          </button>
        </div>
      </div>
    )
  }

  if (!sg.game) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-900">
        <div className="animate-pulse text-cyan-400 text-lg">正在生成目标...</div>
      </div>
    )
  }

  const game = sg.game

  return (
    <InteractiveMapBase
      key={game.game_id}
      startLng={game.start_lng}
      startLat={game.start_lat}
      mode={game.mode}
      difficulty={game.difficulty}
      initZoom={propInitZoom ?? sg.lastZoomRef.current ?? undefined}
      gameIdRef={sg.gameIdRef}
      endedRef={sg.endedRef}
      apiAdapter={apiAdapter}
      cruiseSpeeds={sg.cruiseSpeeds}
      onCheckView={sg.onCheckView}
      setTotalDist={sg.setTotalDist}
      isMobile={sg.isMobile}
    >
      {(handle) => {
        sg.handleRef.current = handle
        const { cruise, picked } = handle
        return (
        <>
      {/* 顶部信息栏 */}
      <div className="absolute top-0 left-0 right-0 z-[1000] flex items-center justify-between px-4 py-2 bg-slate-900/80 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="text-slate-400 hover:text-white text-sm px-2 py-1 rounded hover:bg-slate-700"
          >
            ← 退出
          </button>
          {title && <span className="text-xs text-cyan-300 font-bold">{title}</span>}
          <span className="text-xs text-slate-400">
            {game.mode === 'national' ? '全国模式' : game.mode === 'provincial' ? '省级模式' : '城市模式'}
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              difficulty === 'easy'
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-rose-500/20 text-rose-300'
            }`}
          >
            {difficulty === 'easy' ? '点选' : '巡航'}
          </span>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <span className={`font-mono font-bold ${sg.timeLeft <= 30 ? 'text-red-400' : 'text-cyan-400'}`}>
            ⏱ {sg.formatTime(sg.timeLeft)}
          </span>
          <span className={`font-mono font-bold ${creditsTextClass(sg.hintCredits)}`}>
            ⚡ {sg.hintCredits}/100
          </span>
          <span className="text-slate-400">步数: {sg.steps}</span>
          {!cruise.cruiseZoomed && (
            <span className="text-slate-400">本次 <span className="text-cyan-400">{cruise.cruiseDistUI.toFixed(1)}</span> / 累积 <span className="text-cyan-400">{(sg.totalDist + cruise.cruiseDistUI).toFixed(0)}</span> km</span>
          )}
        </div>
      </div>

      {/* 目标地名提示 */}
      {game.hint_text && (
        <div className="absolute top-[110px] left-1/2 -translate-x-1/2 z-[1105] bg-amber-900/85 backdrop-blur-sm text-amber-200 text-base px-5 py-2.5 rounded-lg max-w-md text-center shadow-lg border border-amber-400/20">
          🎯 目标：{game.hint_text}
        </div>
      )}

      {/* C 救济：当前所在省/市 */}
      {sg.locationHint && !sg.showResult && (
        <div className="absolute top-[44px] left-1/2 -translate-x-1/2 z-[1110] bg-slate-800/85 backdrop-blur-sm text-slate-200 text-xs px-3 py-1 rounded-full shadow border border-slate-600/50 animate-[fadeIn_0.3s_ease-out]">
          📍 {sg.locationHint.text}
        </div>
      )}

      {/* B 救济：快到了 toast */}
      {sg.reliefMsg && (
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 z-[1170] bg-emerald-900/85 backdrop-blur-md text-emerald-50 text-base font-bold px-6 py-3 rounded-xl shadow-2xl border border-emerald-400/40 animate-[fadeIn_0.2s_ease-out]">
          {sg.reliefMsg}
        </div>
      )}

      {/* 简单模式点击未命中提示 */}
      {sg.missMsg && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[1150] bg-red-900/55 backdrop-blur-md text-red-50 text-lg font-medium px-8 py-5 rounded-md shadow-2xl border border-red-400/40 text-center max-w-[calc(100%-3rem)]">
          ❌ {sg.missMsg}
        </div>
      )}

      {/* 开局目标封面图 */}
      <CoverImage
        src={game.target_cover}
        stage={sg.coverStage}
        isMobile={sg.isMobile}
        preview={sg.coverPreview}
        onStageChange={sg.setCoverStage}
        onPreviewToggle={() => sg.setCoverPreview((v) => !v)}
        hintText={game.hint_text}
        variant="solo"
      />

      {/* 开局玩法引导 */}
      <GuideModal
        show={sg.showGuide && !sg.showResult}
        difficulty={difficulty}
        variant="solo"
        cruiseSpeeds={sg.cruiseSpeeds}
        onDismiss={sg.dismissGuide}
      />

      {/* 简单模式面板 */}
      <EasyModePanel
        picked={picked}
        submitting={sg.submitting}
        showResult={sg.showResult}
        onPickConfirm={sg.handlePickConfirm}
        showPanel={difficulty === 'easy' && !sg.showResult}
        hints={sg.hints}
        isMobile={sg.isMobile}
        onGiveUp={sg.handleGiveUp}
        hintCredits={sg.hintCredits}
        easyDirHint={sg.easyDirHint}
        onHint={sg.handleHint}
        hintCostRenderer={(level) =>
          level === 1
            ? `📍 目标省份 ${hintCostText(5, 3, sg.isMobile)}`
            : `💡 方向 ${hintCostText(10, 5, sg.isMobile)}`
        }
        showProvinceHint={game.mode !== 'provincial'}
        provinceHintUsed={sg.hints.some((h) => h.hint_level === 1)}
      />

      {/* 困难模式面板 */}
      <HardModePanel
        show={difficulty !== 'easy' && !sg.showResult}
        cruise={cruise}
        totalDist={sg.totalDist}
        jumpDistances={sg.jumpDistances}
        moving={sg.moving}
        distanceInput={sg.distanceInput}
        onDistanceInputChange={sg.setDistanceInput}
        onJump={sg.handleJump}
        onJumpDistance={sg.jumpDistance}
        hintCredits={sg.hintCredits}
        hints={sg.hints}
        isMobile={sg.isMobile}
        onHint={sg.handleHint}
        hintCostRenderer={(level) =>
          level === 1
            ? `📍 省份 ${hintCostText(5, 3, sg.isMobile)}`
            : `🧭 方位 ${hintCostText(40, 20, sg.isMobile)}`
        }
        showProvinceHint={game.mode !== 'provincial'}
        provinceHintUsed={sg.hints.some((h) => h.hint_level === 1)}
        onGiveUp={sg.handleGiveUp}
      />

      {/* solo 模式内置结算面板 */}
      {variant === 'solo' && sg.showResult && sg.endedResult && (
        <GameResultPanel
          variant="solo"
          hit={sg.endedResult.hit}
          distanceKm={sg.endedResult.distanceKm}
          score={sg.endedResult.score}
          durationSec={sg.endedResult.durationSec}
          steps={sg.endedResult.steps}
          totalDistanceKm={sg.endedResult.totalDistanceKm}
          difficulty={difficulty}
          targetName={sg.endedResult.targetName}
          targetPoiId={sg.endedResult.targetPoiId}
          targetCover={sg.endedResult.targetCover}
          targetSummary={sg.endedResult.targetSummary}
          contributor={sg.contributor}
          onLeave={onBack}
          onNewGame={sg.handleNewGame}
        />
      )}

      {/* 错误提示 */}
      {sg.error && sg.game && (
        <div className="absolute bottom-4 right-4 z-[1000] bg-red-900/80 text-red-200 text-sm px-4 py-2 rounded-lg">
          {sg.error}
        </div>
      )}
        </>
        )
      }}
    </InteractiveMapBase>
  )
}
