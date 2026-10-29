/**
 * HardModePanel — 困难模式 UI 面板
 * 包含：边缘 8 方向按钮 + 中心仪表盘 + 巡航 toast + 提示面板 + 放弃按钮
 *
 * 从 Game.tsx / PKGame.tsx 抽取。
 * Solo 模式有完整提示面板（hintCredits / level 1-2），
 * PK 模式仅有轻量放弃按钮，通过 props 控制差异。
 */
import type { ReactNode } from 'react'
import type { CruiseSystemReturn } from '../base/useCruiseSystem'
import { EdgeDirButtons } from './EdgeDirButtons'
import { CruiseDashboard, CruiseToast } from './CruiseDashboard'

/** 困难模式提示项（solo HintResponse / pk PKHintResponse 共有字段） */
export interface HardHintItem {
  hint_level: number
  content: string
}

interface HardModePanelProps {
  // ---- 显示控制 ----
  /** 是否显示（difficulty !== 'easy' && !showResult） */
  show: boolean

  // ---- 巡航系统（由 InteractiveMapBase 注入）----
  cruise: CruiseSystemReturn

  // ---- 仪表盘数据 ----
  totalDist: number
  jumpDistances: number[]
  moving: boolean
  distanceInput: string
  onDistanceInputChange: (v: string) => void
  onJump: () => void
  onJumpDistance: (km: number) => void

  // ---- Solo 独有：提示面板（PK 不传 onHint 则不渲染提示面板，改为轻量放弃按钮）----
  hintCredits?: number
  hints: HardHintItem[]
  isMobile: boolean
  onHint?: (level: number) => void
  hintCostRenderer?: (level: number) => ReactNode
  showProvinceHint?: boolean
  provinceHintUsed?: boolean

  // ---- 放弃 ----
  onGiveUp: () => void
  giveUpDisabled?: boolean
  /** PK 模式使用轻量放弃按钮（左下角小按钮），solo 使用完整面板内放弃按钮 */
  pkStyleGiveUp?: boolean
}

export function HardModePanel(props: HardModePanelProps) {
  const {
    show,
    cruise,
    totalDist,
    jumpDistances,
    moving,
    distanceInput,
    onDistanceInputChange,
    onJump,
    onJumpDistance,
    hintCredits,
    hints,
    isMobile,
    onHint,
    hintCostRenderer,
    showProvinceHint,
    provinceHintUsed,
    onGiveUp,
    giveUpDisabled,
    pkStyleGiveUp,
  } = props

  if (!show) return null

  const hasSoloPanel = !!onHint && hintCredits !== undefined

  return (
    <>
      {/* 边缘 8 方向巡航按钮 */}
      <EdgeDirButtons
        cruiseDirUI={cruise.cruiseDirUI}
        onCruiseClick={cruise.handleCruiseClick}
      />

      {/* 中心仪表盘（仅在巡航方向存在时显示） */}
      {cruise.cruiseDirUI && (
        <CruiseDashboard
          cruiseDirUI={cruise.cruiseDirUI}
          cruiseSpeedUI={cruise.cruiseSpeedUI}
          cruiseDistUI={cruise.cruiseDistUI}
          cruiseZoomed={cruise.cruiseZoomed}
          totalDist={totalDist}
          jumpDistances={jumpDistances}
          moving={moving}
          distanceInput={distanceInput}
          onDistanceInputChange={onDistanceInputChange}
          onStop={cruise.stopCruise}
          onJump={onJump}
          onJumpDistance={onJumpDistance}
        />
      )}

      {/* 巡航 toast */}
      <CruiseToast msg={cruise.cruiseMsg} />

      {/* 提示面板（solo）或轻量放弃按钮（pk） */}
      {hasSoloPanel ? (
        <div className="absolute bottom-20 left-2 right-2 z-[1000] bg-slate-800/90 backdrop-blur-sm rounded-xl p-3 md:bottom-4 md:left-4 md:right-auto md:w-56">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-400">提示</span>
            <span className={`text-xs font-mono font-bold ${hintCredits! <= 20 ? 'text-red-400' : 'text-cyan-400'}`}>⚡ {hintCredits}/100</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {showProvinceHint && (
              <button
                onClick={() => onHint!(1)}
                disabled={provinceHintUsed}
                className="py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded-lg disabled:opacity-40"
              >
                {hintCostRenderer!(1)}
              </button>
            )}
            <button
              onClick={() => onHint!(2)}
              disabled={(hintCredits ?? 0) < (isMobile ? 20 : 40)}
              className="py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded-lg disabled:opacity-40"
            >
              {hintCostRenderer!(2)}
            </button>
          </div>
          {hints.length > 0 && (
            <div className="mt-2 space-y-1">
              {(isMobile ? hints.slice(-1) : hints).map((h) => (
                <div key={h.hint_level} className="text-xs text-cyan-300 bg-slate-700/50 rounded px-2 py-1">
                  {h.content}
                </div>
              ))}
            </div>
          )}
          <button
            onClick={onGiveUp}
            className="w-full mt-2 py-1.5 text-xs text-slate-500 hover:text-red-400 transition-colors"
          >
            放弃本局
          </button>
        </div>
      ) : (
        pkStyleGiveUp && (
          <button
            onClick={onGiveUp}
            disabled={giveUpDisabled}
            className="absolute bottom-4 left-16 z-[1000] px-3 py-1.5 text-xs text-slate-400 hover:text-red-400 bg-slate-800/70 rounded-lg backdrop-blur-sm border border-slate-600/40 transition-colors disabled:opacity-40"
          >
            放弃本局
          </button>
        )
      )}
    </>
  )
}
