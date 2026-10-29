/**
 * CoverImage — 开局目标封面图组件
 * 三阶段：big（3 秒大图）→ thumb（移动端缩略图常驻）→ hidden
 * solo 和 pk 样式略有差异，通过 variant 控制
 */
interface CoverImageProps {
  src: string | null | undefined
  stage: 'big' | 'thumb' | 'hidden'
  isMobile: boolean
  preview: boolean
  onStageChange: (stage: 'big' | 'thumb' | 'hidden') => void
  onPreviewToggle: () => void
  /** 隐藏条件：PK 在结算时隐藏 */
  hidden?: boolean
  /** solo 模式独有：大图阶段展示目标地名 */
  hintText?: string | null
  variant?: 'solo' | 'pk'
}

export function CoverImage(props: CoverImageProps) {
  const { src, stage, isMobile, preview, onStageChange, onPreviewToggle, hidden, hintText, variant = 'solo' } = props
  if (!src) return null

  // big 阶段：solo 有可点击 overlay + hint_text，pk 仅展示图片
  if (stage === 'big' && !hidden) {
    if (variant === 'solo') {
      return (
        <div
          className="absolute inset-0 z-[1250] flex items-center justify-center bg-black/70 backdrop-blur-sm cursor-pointer"
          onClick={() => onStageChange(isMobile ? 'thumb' : 'hidden')}
        >
          <div className="flex flex-col items-center gap-2 animate-[fadeIn_0.3s_ease-out]">
            <img
              src={src}
              alt="目标封面"
              className={`object-cover rounded-xl shadow-2xl border-2 border-white/20 ${
                isMobile ? 'w-[240px] h-[135px]' : 'w-[320px] h-[180px]'
              }`}
            />
            {hintText && (
              <div className="text-white text-sm font-medium bg-slate-900/70 px-3 py-1 rounded-full">
                🎯 {hintText}
              </div>
            )}
            <div className="text-slate-300 text-xs">点击跳过 · 3 秒后消失</div>
          </div>
        </div>
      )
    }
    // pk variant
    return (
      <div
        className="absolute inset-0 z-[1300] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm"
        style={{ animation: 'fadeIn 0.25s ease-out both' }}
      >
        <img
          src={src}
          alt="目标线索"
          className="max-w-[88vw] max-h-[80vh] object-cover rounded-2xl shadow-2xl border border-white/10"
        />
      </div>
    )
  }

  // thumb 阶段：移动端常驻缩略图
  if (stage === 'thumb' && !hidden) {
    if (variant === 'solo') {
      return (
        <button
          onClick={onPreviewToggle}
          className="absolute top-2 right-2 z-[1100] rounded-lg overflow-hidden border-2 border-white/30 shadow-lg"
          title="点击放大回看"
        >
          <img src={src} alt="目标封面" className="w-12 h-12 object-cover" />
        </button>
      )
    }
    // pk variant
    return (
      <button
        onClick={onPreviewToggle}
        className="absolute top-[60px] right-3 z-[1150] w-12 h-12 rounded-lg overflow-hidden border-2 border-cyan-400/60 shadow-lg"
        style={{ animation: 'fadeIn 0.3s ease-out both' }}
        title="点击预览 / 收起"
      >
        <img src={src} alt="目标线索" className="w-full h-full object-cover" />
      </button>
    )
  }

  // preview 阶段：移动端缩略图放大回看
  if (preview && stage === 'thumb' && !hidden) {
    if (variant === 'solo') {
      return (
        <div
          className="absolute inset-0 z-[1300] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => onPreviewToggle()}
        >
          <img src={src} alt="目标封面" className="object-cover rounded-xl shadow-2xl border-2 border-white/20 w-[240px] h-[135px]" />
        </div>
      )
    }
    // pk variant
    return (
      <div
        className="absolute inset-0 z-[1300] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm"
        onClick={() => onPreviewToggle()}
      >
        <img src={src} alt="目标线索" className="max-w-[88vw] max-h-[80vh] object-cover rounded-2xl shadow-2xl border border-white/10" />
      </div>
    )
  }

  return null
}
