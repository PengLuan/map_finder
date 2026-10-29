/**
 * GuideModal — 开局玩法引导弹窗
 * 从 Game.tsx / PKGame.tsx 抽取，solo 和 pk 内容略有差异（pk 追加对战说明）
 * 通过 variant 控制内容差异
 */
interface GuideModalProps {
  show: boolean
  difficulty: string
  variant: 'solo' | 'pk'
  cruiseSpeeds: number[]
  onDismiss: () => void
}

export function GuideModal(props: GuideModalProps) {
  const { show, difficulty, variant, cruiseSpeeds, onDismiss } = props
  if (!show) return null

  const isEasy = difficulty === 'easy'

  return (
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[1200] w-[26rem] max-w-[calc(100%-2rem)] bg-slate-900/95 backdrop-blur-md border border-cyan-400/30 rounded-2xl shadow-2xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-bold text-cyan-300">
          {isEasy ? '🌱 点选模式 · 玩法' : '🔥 巡航模式 · 玩法'}
        </span>
        <button
          onClick={onDismiss}
          className="text-xs text-slate-300 hover:text-white px-3 py-1 rounded-lg bg-slate-700/70 hover:bg-cyan-600 transition-colors"
        >
          不再提示
        </button>
      </div>
      {isEasy ? (
        <ul className="text-xs text-slate-300 space-y-1.5 leading-relaxed">
          {variant === 'pk' && (
            <li>1. 顶部提示说明了目标所在的地区</li>
          )}
          <li>{variant === 'pk' ? '2' : '1'}. 拖拽移动地图，滚轮或右下角 +/− 缩放</li>
          <li>{variant === 'pk' ? '3' : '2'}. 点击地图放置 <span className="text-green-400">📍 落点标记</span>，可拖拽标记微调位置</li>
          <li>{variant === 'pk' ? '4' : '3'}. 点击「<span className="text-green-400">确认目标位置</span>」提交：距目标 <span className="text-green-400">500 米内</span>即{variant === 'pk' ? '命中' : '获胜'}；未命中会提示距离范围（如 5-20km）</li>
          {variant === 'pk' && (
            <li>⚔️ 与对手比速度，<span className="text-amber-300">先命中者获胜</span>！时限为巡航模式的一半</li>
          )}
        </ul>
      ) : (
        <ul className="text-xs text-slate-300 space-y-1.5 leading-relaxed">
          <li>1. 顶部提示说明了目标所在的地区</li>
          <li>2. 点击屏幕边缘 <span className="text-cyan-400">8 方向按钮</span> 启动巡航，再次点击同方向<span className="text-cyan-400">速度翻倍</span>（{cruiseSpeeds[0]}→{cruiseSpeeds[cruiseSpeeds.length - 1]} km/秒），点反方向或中心<span className="text-red-400">飞机停止</span></li>
          <li>3. 键盘 <span className="text-cyan-400">WASD/方向键</span> 巡航，可组合（如 <span className="text-cyan-400">D+S=东南</span>）、<span className="text-cyan-400">QEZC</span> 直接斜向、<span className="text-cyan-400">Space</span> 停止、<span className="text-cyan-400">Shift</span> 精细（速度/5）</li>
          <li>4. 也可拖拽地图，或用中心仪表盘快捷/自定义公里数<span className="text-cyan-400">跳转</span></li>
          <li>5. 比例尺锁定，不能缩放；{variant === 'pk' ? '与对手比速度，<span className="text-amber-300">先让目标进入自己视野者获胜</span>！' : '当<span className="text-green-400">目标</span>进入视野即获胜'}</li>
        </ul>
      )}
    </div>
  )
}
