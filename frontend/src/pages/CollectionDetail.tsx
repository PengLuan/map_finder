/**
 * CollectionDetail — 专题详情页（预告卡）
 * 展示：封面 + 3 行文化背景 + 难度数据（平均用时、完成率、星级）+ 两个难度按钮（FE-06）
 */
import { useState, useEffect, useCallback, Fragment } from 'react'
import { collectionApi, type CollectionDetail } from '../api/collection'

interface Props {
  code: string
  onBack: () => void
  onStart: (code: string, difficulty: string) => void
}

function formatTime(s: number) {
  if (!s) return '—'
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function CollectionDetail({ code, onBack, onStart }: Props) {
  const [detail, setDetail] = useState<CollectionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await collectionApi.detail(code)
      setDetail(res.data)
    } catch (e: any) {
      setError(e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [code])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-900 text-slate-400">
        加载中...
      </div>
    )
  }
  if (error || !detail) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-slate-900">
        <p className="text-red-400 mb-4">{error || '专题不存在'}</p>
        <button onClick={onBack} className="px-6 py-2 bg-slate-700 rounded-lg hover:bg-slate-600">
          返回
        </button>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-3xl mx-auto p-4">
        <button onClick={onBack} className="text-sm text-slate-400 hover:text-cyan-300 mb-3">
          ← 返回专题列表
        </button>

        {/* 预告卡 */}
        <div className="bg-slate-800/80 rounded-2xl border border-slate-700 overflow-hidden shadow-xl">
          {/* 封面 */}
          {detail.cover_url && (
            <div className="relative h-48 md:h-64 overflow-hidden">
              <img src={detail.cover_url} alt={detail.name} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/30 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-amber-400">{'★'.repeat(Math.min(detail.difficulty_star, 5))}</span>
                  <span className="text-xs text-slate-300">★{detail.difficulty_star} 难度</span>
                </div>
                <h1 className="font-hud text-2xl md:text-3xl text-white glow-cyan">{detail.name}</h1>
              </div>
            </div>
          )}

          <div className="p-5">
            {!detail.cover_url && (
              <div className="mb-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-amber-400">{'★'.repeat(Math.min(detail.difficulty_star, 5))}</span>
                  <span className="text-xs text-slate-400">★{detail.difficulty_star} 难度</span>
                </div>
                <h1 className="font-hud text-2xl md:text-3xl text-cyan-400 glow-cyan">{detail.name}</h1>
              </div>
            )}

            {/* 3 行文化背景 */}
            {detail.description && (
              <p className="text-sm text-slate-300 leading-relaxed mb-4">
                {detail.description}
              </p>
            )}

            {/* 难度数据 */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              <div className="bg-slate-900/60 rounded-lg p-3 text-center">
                <div className="text-xs text-slate-400 mb-1">点位数</div>
                <div className="text-lg font-bold text-cyan-300">{detail.point_count}</div>
              </div>
              <div className="bg-slate-900/60 rounded-lg p-3 text-center">
                <div className="text-xs text-slate-400 mb-1">平均用时</div>
                <div className="text-lg font-bold text-cyan-300">{formatTime(detail.avg_time_sec)}</div>
              </div>
              <div className="bg-slate-900/60 rounded-lg p-3 text-center">
                <div className="text-xs text-slate-400 mb-1">完成率</div>
                <div className="text-lg font-bold text-cyan-300">{detail.finish_rate ? `${detail.finish_rate.toFixed(0)}%` : '—'}</div>
              </div>
            </div>

            {/* 收集顺序（起点 → 终点） */}
            {detail.points.length > 0 && (
              <div className="mb-5">
                <div className="text-xs text-slate-400 mb-2">收集顺序（共 {detail.point_count} 站）</div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {detail.points.map((p, i) => (
                    <Fragment key={i}>
                      <span
                        className={`px-2.5 py-1 rounded-lg text-xs ${
                          i === 0
                            ? 'bg-cyan-600/30 text-cyan-300 border border-cyan-500/40'
                            : i === detail.points.length - 1
                              ? 'bg-amber-600/20 text-amber-300 border border-amber-500/40'
                              : 'bg-slate-700/60 text-slate-300'
                        }`}
                      >
                        {i + 1}. {p.name}
                        {i === 0 ? ' · 起点' : i === detail.points.length - 1 ? ' · 终点' : ''}
                      </span>
                      {i < detail.points.length - 1 && (
                        <span className="text-slate-500 text-xs">→</span>
                      )}
                    </Fragment>
                  ))}
                </div>
              </div>
            )}

            {/* 难度按钮 */}
            {detail.unlocked ? (
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => onStart(code, 'easy')}
                  className="py-3 rounded-xl border-2 border-emerald-400/60 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition-all font-bold text-sm"
                >
                  🌱 点选模式
                  <span className="block text-[10px] font-normal mt-0.5 opacity-80">点击判定 · 只解锁不发勋章</span>
                </button>
                <button
                  onClick={() => onStart(code, 'hard')}
                  className="py-3 rounded-xl border-2 border-orange-400/60 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20 transition-all font-bold text-sm"
                >
                  🔥 巡航模式
                  <span className="block text-[10px] font-normal mt-0.5 opacity-80">视野判定 · 完成获勋章</span>
                </button>
              </div>
            ) : (
              <div className="text-center py-4 bg-slate-900/60 rounded-xl">
                <div className="text-3xl mb-2">🔒</div>
                <div className="text-sm text-slate-400">
                  完成 {detail.unlock_require} 个 ★{detail.difficulty_star - 1} 专题即可解锁
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
