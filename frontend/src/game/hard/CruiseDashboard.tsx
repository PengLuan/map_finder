import { DIR_LABEL, DIR_ANGLE } from '../base/constants'

/**
 * CruiseDashboard — 困难模式中心仪表盘
 * 包含：速度表盘 + 飞机方向指示 + 停止按钮 + 距离快捷跳转 + 自定义距离跳转
 * 从 Game.tsx / PKGame.tsx 抽取，行为完全一致
 */
interface CruiseDashboardProps {
  cruiseDirUI: string
  cruiseSpeedUI: number
  cruiseDistUI: number
  cruiseZoomed: boolean
  totalDist: number
  jumpDistances: number[]
  moving: boolean
  distanceInput: string
  onDistanceInputChange: (v: string) => void
  onStop: () => void
  onJump: () => void
  onJumpDistance: (km: number) => void
}

export function CruiseDashboard(props: CruiseDashboardProps) {
  const {
    cruiseDirUI,
    cruiseSpeedUI,
    cruiseDistUI,
    cruiseZoomed,
    totalDist,
    jumpDistances,
    moving,
    distanceInput,
    onDistanceInputChange,
    onStop,
    onJump,
    onJumpDistance,
  } = props

  return (
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[1150] flex flex-col items-center gap-2 pointer-events-none">
      {/* 速度表盘 */}
      <div className="bg-slate-900/75 backdrop-blur-md rounded-2xl px-7 py-3 text-center pointer-events-auto border-2 border-cyan-400/40 shadow-2xl">
        {cruiseZoomed ? (
          // 巡航降级期间：显示当前时速（白色大字）
          <>
            <div className="text-[11px] text-white/70 tracking-[0.25em]">SPEED · {DIR_LABEL[cruiseDirUI]}</div>
            <div className="font-mono text-4xl font-bold text-white leading-tight">
              {cruiseSpeedUI}<span className="text-sm text-slate-400 ml-1 font-normal">km/秒</span>
            </div>
          </>
        ) : (
          <>
            <div className="text-[11px] text-cyan-400/70 tracking-[0.25em]">SPEED · {DIR_LABEL[cruiseDirUI]}</div>
            <div className="font-mono text-4xl font-bold text-cyan-300 leading-tight">
              {cruiseSpeedUI}<span className="text-sm text-slate-400 ml-1 font-normal">km/秒</span>
            </div>
            <div className="text-sm text-slate-300 mt-1">
              本次 <span className="text-cyan-300 font-bold">{cruiseDistUI.toFixed(1)}</span> <span className="text-slate-500">/</span> 累积 <span className="text-cyan-300 font-bold">{(totalDist + cruiseDistUI).toFixed(0)}</span> km
            </div>
          </>
        )}
      </div>
      {/* 飞机方向指示（白色透明，大） */}
      <svg
        width="72"
        height="72"
        viewBox="0 0 24 24"
        className="pointer-events-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
        style={{ transform: `rotate(${DIR_ANGLE[cruiseDirUI]}deg)`, transition: 'transform 0.2s' }}
      >
        <path d="M21 16v-2l-8-5V3.5C13 2.67 12.33 2 11.5 2S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" fill="#ffffff" opacity="0.85" />
      </svg>
      {/* 停止按钮（独立） */}
      <button
        onClick={onStop}
        title="点击停止巡航"
        className="flex items-center gap-2 px-6 py-2 rounded-xl bg-red-600/90 hover:bg-red-500 border-2 border-red-300/60 pointer-events-auto backdrop-blur-md shadow-lg shadow-red-900/50 transition-colors"
      >
        <span className="text-white text-lg leading-none">■</span>
        <span className="text-sm font-bold text-white tracking-wider">停止</span>
      </button>
      {/* 距离快捷跳转（两排 × 3） */}
      <div className="grid grid-cols-3 gap-1.5 pointer-events-auto">
        {jumpDistances.map((km) => (
          <button
            key={km}
            onClick={() => onJumpDistance(km)}
            disabled={moving}
            className="px-3 py-1.5 text-sm bg-slate-800/85 hover:bg-cyan-600 border border-cyan-400/30 rounded-lg text-white font-medium disabled:opacity-50 transition-colors"
          >
            {km}km
          </button>
        ))}
      </div>
      {/* 自定义距离跳转 */}
      <div className="flex gap-1.5 pointer-events-auto">
        <input
          type="text"
          inputMode="numeric"
          placeholder="自定义 km"
          value={distanceInput}
          onChange={(e) => onDistanceInputChange(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter') onJump() }}
          className="w-24 bg-slate-800/85 border border-cyan-400/30 rounded-lg px-2 py-1.5 text-sm text-white text-center focus:outline-none focus:border-cyan-400"
        />
        <button
          onClick={onJump}
          disabled={moving}
          className="px-3 py-1.5 text-sm bg-cyan-600 hover:bg-cyan-500 rounded-lg text-white font-medium disabled:opacity-50 transition-colors"
        >
          跳转
        </button>
      </div>
    </div>
  )
}

/** 巡航 toast（与仪表盘配套使用） */
interface CruiseToastProps {
  msg: string
}

export function CruiseToast({ msg }: CruiseToastProps) {
  if (!msg) return null
  return (
    <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-[1200] bg-cyan-900/80 backdrop-blur-md text-cyan-100 text-sm px-4 py-2 rounded-lg shadow-lg border border-cyan-400/20">
      {msg}
    </div>
  )
}
