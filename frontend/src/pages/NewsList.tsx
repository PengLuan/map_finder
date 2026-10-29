/**
 * NewsList — 「小寻带你看新闻」栏目页
 * 时间线卡片网格：封面图 + 简介 + 进度，点击进入选模式
 */
import { useState, useEffect, useCallback } from 'react'
import { newsApi } from '../api/news'
import type { NewsTimelineItem } from '../api/news'

interface Props {
  onBack: () => void
  onOpen: (code: string) => void
}

export default function NewsList({ onBack, onOpen }: Props) {
  const [items, setItems] = useState<NewsTimelineItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    newsApi.list()
      .then((res) => setItems(res.data))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-4xl mx-auto p-4 pt-6">
        <button onClick={onBack} className="text-sm text-slate-400 hover:text-cyan-300 transition-colors">
          ← 返回首页
        </button>
        <div className="text-center my-5">
          <h1 className="font-hud text-2xl md:text-3xl text-cyan-400 glow-cyan">📰 小寻带你看新闻</h1>
          <p className="text-slate-400 mt-1 text-sm">选择一条时间线，沿着事件发生顺序找点，找齐解锁新闻卡片</p>
        </div>

        {loading && <div className="text-center text-cyan-400 animate-pulse py-12">加载中...</div>}
        {error && <div className="text-center text-rose-400 py-8">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-10">
          {items.map((t) => {
            const eFound = t.found_easy ?? 0
            const hFound = t.found_hard ?? 0
            const pct = t.point_count > 0 ? (Math.max(eFound, hFound) / t.point_count) * 100 : 0
            const color = t.color ?? '#22d3ee'
            return (
              <button
                key={t.code}
                onClick={() => onOpen(t.code)}
                className="text-left rounded-2xl border border-slate-700 bg-slate-800/60 hover:bg-slate-800 hover:border-slate-500 transition-all overflow-hidden group shadow-lg hover:shadow-xl"
              >
                {/* 封面图 */}
                <div className="relative h-40 overflow-hidden">
                  {t.cover_url ? (
                    <img
                      src={t.cover_url}
                      alt={t.name}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : (
                    <div
                      className="w-full h-full"
                      style={{ background: `linear-gradient(135deg, ${color} 0%, #1f2937 100%)` }}
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/20 to-transparent" />
                  {t.completed && (
                    <span className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-full bg-emerald-500/90 text-white text-xs font-bold shadow">
                      ✓ 双模式找齐
                    </span>
                  )}
                  <div className="absolute bottom-2.5 left-3.5 right-3.5">
                    <h2 className="font-bold text-white text-base leading-snug drop-shadow">{t.name}</h2>
                    <p className="text-[11px] text-slate-300/90 mt-0.5">
                      {t.batch ?? ''} · {t.point_count} 个事件
                    </p>
                  </div>
                </div>
                {/* 简介 + 双模式进度 */}
                <div className="p-3.5">
                  <p className="text-xs text-slate-400 leading-relaxed line-clamp-2 min-h-[2rem]">{t.description}</p>
                  <div className="flex items-center gap-2 mt-3 text-xs">
                    <span className="text-emerald-300 whitespace-nowrap">🌱 {eFound}/{t.point_count}</span>
                    <span className="text-orange-300 whitespace-nowrap">🔥 {hFound}/{t.point_count}</span>
                    <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
                    </div>
                    <span className="font-bold opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap" style={{ color }}>
                      开始 →
                    </span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {!loading && !error && items.length === 0 && (
          <div className="text-center text-slate-500 py-12">暂无上线的时间线，敬请期待</div>
        )}
      </div>
    </div>
  )
}
