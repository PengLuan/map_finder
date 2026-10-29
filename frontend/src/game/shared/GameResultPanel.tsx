/**
 * GameResultPanel — 结算面板
 * 支持单人 (solo) 和对战 (pk) 两种变体，通过 variant 控制
 *
 * solo：目标封面(带命中/未命中 badge) + 得分/用时/步数列表 + 操作按钮
 * pk：胜负标题 + 目标封面 + 双方得分对比 + 操作按钮(4 种状态)
 */
interface GameResultPanelProps {
  variant: 'solo' | 'pk'

  // ===== Solo 独有 =====
  /** 命中/未命中 */
  hit?: boolean
  /** 距离目标 km（命中时为点击精度，未命中时为最终距离） */
  distanceKm?: number
  /** 得分 */
  score?: number
  /** 用时秒 */
  durationSec?: number
  /** 步数 */
  steps?: number
  /** 总距离 km */
  totalDistanceKm?: number
  /** 难度：困难模式命中后不显示"距离目标" */
  difficulty?: string

  // ===== PK 独有 =====
  /** 平局 */
  isDraw?: boolean
  /** 我方胜利 */
  iWon?: boolean
  /** 胜负原因：opponent_left / timeout / draw */
  winReason?: string | null
  /** 我方得分 */
  myScore?: number
  /** 对手得分 */
  opponentScore?: number
  /** 对手昵称 */
  opponentNickname?: string
  /** 我方距目标 km */
  myToTargetKm?: number | null
  /** 对手距目标 km */
  opponentToTargetKm?: number | null
  /** 我方命中 */
  myHit?: boolean
  /** 对手命中 */
  opponentHit?: boolean

  // ===== 通用 =====
  targetName?: string
  targetPoiId?: number | null
  targetCover?: string | null
  targetSummary?: string | null
  contributor?: string | null

  // ===== PK 操作状态 =====
  /** 对手已离开确认 */
  opponentLeftConfirmed?: boolean
  /** 对手离开倒计时 */
  opponentLeftCountdown?: number
  /** 我方已请求再战 */
  rematchRequested?: boolean
  /** 对方已请求再战 */
  opponentRematch?: boolean

  // ===== 操作回调 =====
  /** 返回首页/大厅 */
  onLeave: () => void
  /** 再来一局（solo） */
  onNewGame?: () => void
  /** 再战（pk） */
  onRematch?: () => void
}

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export function GameResultPanel(props: GameResultPanelProps) {
  const {
    variant,
    hit,
    distanceKm,
    score,
    durationSec,
    steps,
    totalDistanceKm,
    difficulty,
    isDraw,
    iWon,
    winReason,
    myScore,
    opponentScore,
    opponentNickname,
    myToTargetKm,
    opponentToTargetKm,
    myHit,
    opponentHit,
    targetName,
    targetPoiId,
    targetCover,
    targetSummary,
    contributor,
    opponentLeftConfirmed,
    opponentLeftCountdown,
    rematchRequested,
    opponentRematch,
    onLeave,
    onNewGame,
    onRematch,
  } = props

  const isSolo = variant === 'solo'

  const handleCorrect = () => {
    if (targetPoiId == null) return
    window.dispatchEvent(new CustomEvent('open-correction', { detail: { poiId: targetPoiId } }))
  }

  return (
    <div className="absolute bottom-0 left-0 right-0 z-[2000] max-h-[60vh] overflow-y-auto result-panel md:bottom-auto md:top-1/2 md:left-[calc(50%-336px)] md:right-auto md:max-h-none md:overflow-visible md:w-80 md:max-w-[calc(100%-2rem)] md:-translate-y-1/2">
      <div className="bg-slate-800/95 backdrop-blur-md rounded-t-2xl md:rounded-2xl rounded-b-none shadow-2xl border border-slate-700 overflow-hidden">
        {/* ===== 头部 ===== */}
        {isSolo ? (
          // solo：目标封面图 + 命中/未命中 badge，无封面时用 emoji 兜底
          targetCover ? (
            <div className="relative h-32 md:h-44 overflow-hidden">
              <img
                src={targetCover}
                alt={targetName}
                className="w-full h-full object-cover cover-zoom"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/25 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 px-5 pb-3.5 pt-8">
                <div
                  className={`inline-flex items-center gap-1 text-[11px] font-bold tracking-widest mb-1.5 px-2 py-0.5 rounded-full ${
                    hit
                      ? 'bg-green-500/20 text-green-300 ring-1 ring-green-400/40'
                      : 'bg-red-500/20 text-red-300 ring-1 ring-red-400/40'
                  }`}
                >
                  {hit ? '🎉 找到了' : '😢 未命中'}
                </div>
                <h2 className="text-xl font-bold text-white leading-tight drop-shadow-md">
                  {targetName}
                </h2>
              </div>
            </div>
          ) : (
            <div className="text-center pt-6 px-6">
              <div className="text-5xl mb-3">{hit ? '🎉' : '😢'}</div>
              <h2 className={`text-2xl font-bold ${hit ? 'text-green-400' : 'text-red-400'}`}>
                {hit ? '找到了！' : '未命中'}
              </h2>
              <p className="text-white font-medium mt-1">{targetName}</p>
            </div>
          )
        ) : (
          // pk：胜负标题横幅
          <div
            className={`text-center py-5 ${
              isDraw
                ? 'bg-gradient-to-r from-amber-600/30 to-yellow-500/30'
                : iWon
                ? 'bg-gradient-to-r from-cyan-600/30 to-green-500/30'
                : 'bg-gradient-to-r from-rose-600/30 to-red-500/30'
            }`}
          >
            <div className="text-4xl mb-1">{isDraw ? '🤝' : iWon ? '🏆' : '💀'}</div>
            <div
              className={`font-display text-2xl font-black tracking-widest ${
                isDraw ? 'text-amber-300' : iWon ? 'text-cyan-300' : 'text-rose-300'
              }`}
            >
              {isDraw ? '平局' : iWon ? '胜利' : '惜败'}
            </div>
            {winReason === 'opponent_left' && (
              <div className="text-xs text-slate-400 mt-1">对手已离开</div>
            )}
            {winReason === 'timeout' && !isDraw && (
              <div className="text-xs text-slate-400 mt-1">倒计时结束 · 按距离判定</div>
            )}
          </div>
        )}

        {/* PK 目标封面（胜负标题下方） */}
        {!isSolo && targetCover && (
          <div className="relative h-36 overflow-hidden">
            <img src={targetCover} alt={targetName} className="w-full h-full object-cover cover-zoom" />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent" />
            <div className="absolute bottom-2 left-4">
              <h3 className="text-lg font-bold text-white drop-shadow">{targetName}</h3>
            </div>
          </div>
        )}

        <div className="p-5">
          {/* ===== 正文：得分区 ===== */}
          {isSolo ? (
            // solo：得分列表
            <div className="space-y-3 mb-5">
              {/* 困难模式命中后不显示"距离目标"——已找到即无距离可言；
                  简单模式命中显示点击精度，未命中（放弃）显示最终距离 */}
              {(difficulty === 'easy' || !hit) && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">{hit ? '点击精度' : '距离目标'}</span>
                  <span className="text-white">{(distanceKm ?? 0).toFixed(1)} km</span>
                </div>
              )}
              {hit && (
                <div className="flex justify-between text-sm items-center">
                  <span className="text-slate-400">得分</span>
                  <span className="text-cyan-400 font-bold text-lg">{score}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">用时</span>
                <span className="text-white">{formatTime(durationSec ?? 0)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">步数 / 总距离</span>
                <span className="text-white">{steps} 步 / {(totalDistanceKm ?? 0).toFixed(0)} km</span>
              </div>
            </div>
          ) : (
            // pk：双方得分对比
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="text-center bg-cyan-500/10 rounded-lg py-3">
                <div className="text-[11px] text-slate-400 mb-1">我的得分</div>
                <div className="font-display text-xl font-bold text-cyan-300">{myScore}</div>
                {/* 困难模式命中后不显示"距目标"——已找到即无距离可言；简单模式/未命中仍显示 */}
                {myToTargetKm != null && !(difficulty !== 'easy' && myHit) && (
                  <div className="text-[11px] text-slate-500 mt-1">
                    {myHit ? '点击精度' : '距目标'} {myToTargetKm} km
                  </div>
                )}
              </div>
              <div className="text-center bg-rose-500/10 rounded-lg py-3">
                <div className="text-[11px] text-slate-400 mb-1 truncate px-1">{opponentNickname}</div>
                <div className="font-display text-xl font-bold text-rose-300">{opponentScore}</div>
                {opponentToTargetKm != null && !(difficulty !== 'easy' && opponentHit) && (
                  <div className="text-[11px] text-slate-500 mt-1">
                    {opponentHit ? '点击精度' : '距目标'} {opponentToTargetKm} km
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 目标简介 */}
          {targetSummary && (
            <div className={`text-xs text-slate-400 bg-slate-700/50 rounded-lg p-3 leading-relaxed ${isSolo ? '' : 'mb-4'}`}>
              {targetSummary}
            </div>
          )}

          {/* 贡献者署名 */}
          {contributor && (
            <div className={`text-xs text-amber-300 bg-amber-500/10 rounded-lg px-3 py-2 ${isSolo ? '' : 'mb-4'}`}>
              本题由「{contributor}」贡献
            </div>
          )}

          {/* 纠正入口：低调小按钮，覆盖 solo 与 pk */}
          {targetPoiId != null && (
            <button
              onClick={handleCorrect}
              className="w-full mb-2 py-1.5 text-xs text-slate-500 hover:text-slate-300 rounded-lg transition-colors"
            >
              ✎ 地点信息有误？纠正此地点
            </button>
          )}

          {/* ===== 操作按钮 ===== */}
          {isSolo ? (
            // solo：返回首页 + 再来一局
            <div className="flex gap-3">
              <button
                onClick={onLeave}
                className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-sm font-medium transition-colors"
              >
                返回首页
              </button>
              <button
                onClick={onNewGame}
                className="flex-1 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 rounded-xl text-sm font-bold text-white transition-colors"
              >
                再来一局
              </button>
            </div>
          ) : opponentLeftConfirmed ? (
            // pk：对手已离开，倒计时自动返回
            <div className="text-center py-3">
              <div className="text-sm text-rose-300 font-medium mb-2">👋 对手已离开</div>
              <div className="text-xs text-slate-400">
                {(opponentLeftCountdown ?? 0) > 0
                  ? `${opponentLeftCountdown} 秒后自动返回大厅…`
                  : '正在返回…'}
              </div>
            </div>
          ) : rematchRequested ? (
            // pk：我方已请求再战，等待对手
            <div className="flex gap-3">
              <button
                onClick={onLeave}
                className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-sm font-medium transition-colors"
              >
                返回大厅
              </button>
              <button
                disabled
                className="flex-1 py-2.5 bg-slate-600 rounded-xl text-sm font-bold text-slate-300 opacity-60"
              >
                {opponentRematch ? '匹配中...' : '等待对手应战...'}
              </button>
            </div>
          ) : opponentRematch ? (
            // pk：对方已请求再战，我方选择接受
            <div className="flex gap-3">
              <button
                onClick={onLeave}
                className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-sm font-medium transition-colors"
              >
                放弃
              </button>
              <button
                onClick={onRematch}
                className="flex-1 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 rounded-xl text-sm font-bold text-white transition-colors"
              >
                接受再战
              </button>
            </div>
          ) : (
            // pk：默认 - 返回大厅 + 再来一局
            <div className="flex gap-3">
              <button
                onClick={onLeave}
                className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-sm font-medium transition-colors"
              >
                返回大厅
              </button>
              <button
                onClick={onRematch}
                className="flex-1 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 rounded-xl text-sm font-bold text-white transition-colors"
              >
                再来一局
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
