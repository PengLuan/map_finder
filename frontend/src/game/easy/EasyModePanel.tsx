/**
 * EasyModePanel — 简单模式 UI 面板
 * 包含：确认落点按钮 + 右侧控制面板（提示 + 放弃）
 *
 * 从 Game.tsx / PKGame.tsx 抽取。
 * Solo 模式有完整提示系统（hintCredits / easyDirHint / level 1-2），
 * PK 模式仅显示提示列表，通过 props 控制差异。
 */
import type { ReactNode } from 'react'

/** 简单模式提示项（solo HintResponse / pk PKHintResponse 共有字段） */
export interface EasyHintItem {
  hint_level: number
  content: string
}

interface EasyModePanelProps {
  // ---- 落点确认（两者共有）----
  picked: { lng: number; lat: number } | null
  submitting: boolean
  showResult: boolean
  onPickConfirm: () => void

  // ---- 右侧控制面板（两者共有）----
  /** 是否显示右侧面板：difficulty === 'easy' && !showResult */
  showPanel: boolean
  /** 提示列表 */
  hints: EasyHintItem[]
  /** 移动端仅显示最后一条 */
  isMobile: boolean
  /** 放弃回调 */
  onGiveUp: () => void
  /** 放弃按钮 disabled（PK 对局已结束时禁用） */
  giveUpDisabled?: boolean

  // ---- Solo 独有：完整提示系统（PK 不传则不渲染）----
  /** 积分（仅 solo） */
  hintCredits?: number
  /** 方向提示气泡（仅 solo level 2） */
  easyDirHint?: string | null
  /** 使用提示回调（仅 solo） */
  onHint?: (level: number) => void
  /** 方向提示消耗文案函数（仅 solo） */
  hintCostRenderer?: (level: number) => ReactNode
  /** 是否显示目标省份提示按钮（solo: mode !== 'provincial'） */
  showProvinceHint?: boolean
  /** 省份提示是否已用（solo: hints.some(h => h.hint_level === 1)） */
  provinceHintUsed?: boolean
}

export function EasyModePanel(props: EasyModePanelProps) {
  const {
    picked,
    submitting,
    showResult,
    onPickConfirm,
    showPanel,
    hints,
    isMobile,
    onGiveUp,
    giveUpDisabled,
    hintCredits,
    easyDirHint,
    onHint,
    hintCostRenderer,
    showProvinceHint,
    provinceHintUsed,
  } = props

  const hasSoloHints = !!onHint && hintCredits !== undefined

  // 控制面板内容（PC 右侧 / 移动底部共用）
  const panelContent = (
    <>
      <div className="hidden md:block text-[11px] text-slate-400 bg-slate-700/40 rounded-lg px-3 py-2 leading-relaxed">
        🎯 缩放并点击地图，<span className="text-green-400">点击</span>你认为的目标位置（距目标 500 米内即获胜）
      </div>
      <div className="mt-0 md:mt-3 border-t border-slate-700 pt-3">
        {hasSoloHints ? (
          <>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-slate-400">提示</div>
              <div className={`text-xs font-mono font-bold ${hintCredits! <= 20 ? 'text-red-400' : 'text-cyan-400'}`}>⚡ {hintCredits}/100</div>
            </div>
            {/* 方向提示（level 2）：可反复点击，刷新最新方向气泡 */}
            <button
              onClick={() => onHint!(2)}
              className="w-full py-1.5 text-xs bg-cyan-700 hover:bg-cyan-600 rounded-lg text-white font-medium"
            >
              {hintCostRenderer!(2)}
            </button>
            {easyDirHint && (
              <div className="mt-2 text-xs text-cyan-200 bg-cyan-900/40 rounded-lg px-2 py-1.5 border border-cyan-500/30">
                {easyDirHint}
              </div>
            )}
            {/* 目标省份（level 1）：省市模式下目标本就在某省，提示省份=给答案，隐藏 */}
            {showProvinceHint && (
              <button
                onClick={() => onHint!(1)}
                disabled={provinceHintUsed}
                className="w-full mt-1.5 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded-lg disabled:opacity-40"
              >
                {hintCostRenderer!(1)}
              </button>
            )}
            {hints.length > 0 && (
              <div className="mt-2 space-y-1">
                {(isMobile ? hints.slice(-1) : hints).map((h) => (
                  <div key={h.hint_level} className="text-xs text-cyan-300 bg-slate-700/50 rounded px-2 py-1">
                    {h.content}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="text-xs text-slate-400 mb-2">提示</div>
            {hints.length > 0 && (
              <div className="mt-2 space-y-1">
                {hints.map((h) => (
                  <div key={h.hint_level} className="text-xs text-cyan-300 bg-slate-700/50 rounded px-2 py-1">
                    {h.content}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <button
        onClick={onGiveUp}
        disabled={giveUpDisabled}
        className="w-full mt-3 py-2 text-xs text-slate-500 hover:text-red-400 transition-colors disabled:opacity-40"
      >
        放弃本局
      </button>
    </>
  )

  return (
    <>
      {/* PC：确认落点按钮（底部居中） */}
      {picked && !showResult && (
        <div className="hidden md:flex absolute bottom-6 left-1/2 -translate-x-1/2 z-[1100] flex-col items-center gap-1.5">
          <button
            onClick={onPickConfirm}
            disabled={submitting}
            className="px-8 py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 text-white font-bold text-sm shadow-lg shadow-emerald-500/30 transition-colors disabled:opacity-60"
          >
            {submitting ? '判定中…' : '📍 确认目标位置'}
          </button>
          <span className="text-[10px] text-slate-300 bg-slate-900/70 rounded-full px-3 py-0.5">
            可拖拽标记微调，确认后才会提交判定
          </span>
        </div>
      )}

      {/* PC：右侧控制面板（提示 + 放弃） */}
      {showPanel && (
        <div className="hidden md:block absolute bottom-4 left-4 z-[1000] bg-slate-800/90 backdrop-blur-sm rounded-xl p-4 w-64">
          {panelContent}
        </div>
      )}

      {/* 移动端：底部栈式面板（确认按钮在上 + 控制内容在下，避免重叠） */}
      {showPanel && (
        <div className="md:hidden absolute bottom-0 left-0 right-0 z-[1100] bg-slate-800/95 backdrop-blur-md rounded-t-2xl border-t border-slate-700 p-3 max-h-[55vh] overflow-y-auto">
          {picked && !showResult && (
            <div className="flex flex-col items-center gap-1 mb-3">
              <button
                onClick={onPickConfirm}
                disabled={submitting}
                className="w-full max-w-xs px-8 py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 text-white font-bold text-sm shadow-lg shadow-emerald-500/30 transition-colors disabled:opacity-60"
              >
                {submitting ? '判定中…' : '📍 确认目标位置'}
              </button>
              <span className="text-[10px] text-slate-300">
                可拖拽标记微调，确认后提交判定
              </span>
            </div>
          )}
          {panelContent}
        </div>
      )}
    </>
  )
}
