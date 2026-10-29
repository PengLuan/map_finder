import { EDGE_DIRS, DIR_LABEL } from '../base/constants'

/**
 * EdgeDirButtons — 困难模式边缘 8 方向巡航按钮
 * 从 Game.tsx / PKGame.tsx 抽取，行为完全一致
 */
interface EdgeDirButtonsProps {
  cruiseDirUI: string | null
  onCruiseClick: (dir: string) => void
}

export function EdgeDirButtons({ cruiseDirUI, onCruiseClick }: EdgeDirButtonsProps) {
  return (
    <>
      {EDGE_DIRS.map((d) => (
        <button
          key={d.key}
          onClick={() => onCruiseClick(d.key)}
          className={`absolute z-[1100] w-12 h-12 flex items-center justify-center rounded-full bg-slate-900/50 hover:bg-cyan-600/70 text-white text-2xl backdrop-blur-md border border-white/20 transition-all ${d.pos} ${cruiseDirUI === d.key ? 'bg-cyan-500/80 ring-2 ring-cyan-300 scale-110' : ''}`}
          title={`${DIR_LABEL[d.key]}：点击巡航，再次点击速度翻倍，反方向或中心停止`}
        >
          {d.icon}
        </button>
      ))}
    </>
  )
}
