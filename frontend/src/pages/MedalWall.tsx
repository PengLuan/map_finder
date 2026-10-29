/**
 * MedalWall — 勋章墙
 * 按难度星级分四档（入门/进阶/精通/大师），展示已获得与未获得的勋章
 */
import { useState, useEffect, useCallback } from 'react'
import {
  collectionApi, isLoggedIn, getStoredUser,
  type MedalWallGroup, type MedalWallItem,
} from '../api/collection'
import { newsApi } from '../api/news'
import type { NewsMedalItem } from '../api/news'
import AuthModal from '../components/AuthModal'

interface Props {
  onBack: () => void
}

const TIERS = [
  { min: 1, max: 2, label: '入门', stars: '★1-2' },
  { min: 3, max: 4, label: '进阶', stars: '★3-4' },
  { min: 5, max: 6, label: '精通', stars: '★5-6' },
  { min: 7, max: 8, label: '大师', stars: '★7-8' },
]

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('zh-CN') } catch { return '—' }
}

function difficultyLabel(d: string): string {
  return d === 'easy' ? '点选' : d === 'hard' ? '巡航' : d
}

export default function MedalWall({ onBack }: Props) {
  const [groups, setGroups] = useState<MedalWallGroup[]>([])
  const [newsMedals, setNewsMedals] = useState<NewsMedalItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAuth, setShowAuth] = useState(false)
  const [authTick, setAuthTick] = useState(0)
  const [mode, setMode] = useState<'all' | 'easy' | 'hard'>('all')

  const load = useCallback(async () => {
    if (!isLoggedIn()) { setLoading(false); return }
    setLoading(true); setError('')
    try {
      const [res, news] = await Promise.all([
        collectionApi.medalWall(undefined, mode === 'all' ? undefined : mode),
        newsApi.medals().catch(() => ({ data: [] as NewsMedalItem[] })),
      ])
      setNewsMedals(news.data)
      // 合并同专题+难度的 solo/pk 勋章：二者达成其一即显示已获得，取最快用时
      const merged: MedalWallGroup[] = res.data.map((g) => {
        const map = new Map<string, MedalWallItem>()
        for (const m of g.medals) {
          const key = `${m.collection_id}-${m.difficulty}`
          const existing = map.get(key)
          if (!existing) {
            map.set(key, { ...m })
          } else if (m.earned) {
            // 如果有任一个已获得，标记为已获得，取最快用时
            existing.earned = true
            if (m.total_time_sec != null && (existing.total_time_sec == null || m.total_time_sec < existing.total_time_sec)) {
              existing.total_time_sec = m.total_time_sec
              existing.earned_at = m.earned_at
            }
          }
        }
        return { ...g, medals: Array.from(map.values()) }
      })
      setGroups(merged)
    } catch (e: any) {
      setError(e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [mode])

  useEffect(() => { load() }, [load, authTick])

  if (!isLoggedIn()) {
    return (
      <div className="h-full flex flex-col bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
        <Header onBack={onBack} title="🎖️ 勋章墙" />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-5xl mb-3">🎖️</div>
            <p className="text-slate-400 mb-4">登录后查看你的勋章墙</p>
            <button
              onClick={() => setShowAuth(true)}
              className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl text-sm font-bold text-white"
            >
              登录 / 注册
            </button>
          </div>
        </div>
        {showAuth && (
          <AuthModal
            onClose={() => setShowAuth(false)}
            onSuccess={() => { setShowAuth(false); setAuthTick((t) => t + 1) }}
          />
        )}
      </div>
    )
  }

  const user = getStoredUser()
  const tiered = TIERS.map((t) => ({
    ...t,
    medals: groups
      .filter((g) => g.star >= t.min && g.star <= t.max)
      .flatMap((g) => g.medals)
      .sort((a, b) => Number(b.earned) - Number(a.earned)),
  }))
  const totalEarned = tiered.flatMap((t) => t.medals).filter((m) => m.earned).length

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      <Header
        onBack={onBack}
        title={`🎖️ ${user?.nickname ?? ''}的勋章墙`}
        subtitle={`已获得 ${totalEarned} 枚勋章`}
      />
      <div className="flex-1 overflow-y-auto p-4 pt-2 min-h-0">
        <div className="max-w-5xl mx-auto">
          {/* 模式切换 */}
          <div className="flex gap-2 justify-center mb-4">
            {(['all', 'easy', 'hard'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${
                  mode === m
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {m === 'all' ? '全部' : m === 'easy' ? '点选' : '巡航'}
              </button>
            ))}
          </div>
          {loading && <div className="text-center text-slate-400 py-10">加载中...</div>}
          {error && <div className="text-center text-red-400 py-10">{error}</div>}

          {/* 新闻勋章（小寻带你看新闻：找齐时间线获得） */}
          {!loading && !error && newsMedals.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3 px-1">
                <span className="text-rose-400">📰</span>
                <span className="font-bold text-cyan-300">新闻勋章</span>
                <span className="text-xs text-slate-500">
                  ({newsMedals.filter((m) => m.earned).length}/{newsMedals.length})
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {newsMedals.map((m) => (
                  <div
                    key={m.timeline_id}
                    className={`p-3 rounded-xl border ${
                      m.earned
                        ? 'border-amber-500/40 bg-slate-800/70'
                        : 'border-slate-700 bg-slate-800/30 opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-lg bg-slate-700/60 flex items-center justify-center shrink-0 overflow-hidden">
                        {m.icon_url ? (
                          <img src={m.icon_url} alt={m.name} className={`w-full h-full object-cover ${m.earned ? '' : 'grayscale'}`} />
                        ) : (
                          <span className="text-2xl">{m.earned ? '🏅' : '🔒'}</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-white text-sm truncate">{m.name}</div>
                        <div className="text-xs text-slate-400 mt-0.5">📰 {m.mode_label}勋章</div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px]">
                      <span className={m.earned ? 'text-amber-300' : 'text-slate-500'}>
                        {m.earned ? '已获得' : '未获得'}
                      </span>
                      <span className="text-slate-500">{m.earned ? formatDate(m.earned_at) : ''}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!loading && !error && tiered.map((t) => (
            <div key={t.min} className="mb-6">
              <div className="flex items-center gap-2 mb-3 px-1">
                <span className="text-amber-400">{t.stars}</span>
                <span className="font-bold text-cyan-300">{t.label}</span>
                <span className="text-xs text-slate-500">
                  ({t.medals.filter((m) => m.earned).length}/{t.medals.length})
                </span>
              </div>
              {t.medals.length === 0 ? (
                <p className="text-xs text-slate-600 px-1">暂无该难度专题</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {t.medals.map((m) => (
                    <MedalCard
                      key={`${m.collection_id}-${m.difficulty}`}
                      medal={m}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function MedalCard({ medal }: { medal: MedalWallItem }) {
  const earned = medal.earned
  return (
    <div
      className={`p-3 rounded-xl border ${
        earned
          ? 'border-amber-500/40 bg-slate-800/70'
          : 'border-slate-700 bg-slate-800/30 opacity-60'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-lg bg-slate-700/60 flex items-center justify-center shrink-0 overflow-hidden">
          {medal.icon_url ? (
            <img
              src={medal.icon_url}
              alt={medal.collection_name}
              className={`w-full h-full object-cover ${earned ? '' : 'grayscale'}`}
            />
          ) : (
            <span className="text-2xl">{earned ? '🏅' : '🔒'}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-white text-sm truncate">{medal.collection_name}</div>
          <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
            <span className="text-cyan-400">{difficultyLabel(medal.difficulty)}</span>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className="text-amber-300">
          {earned && medal.total_time_sec != null
            ? `⏱ ${formatTime(medal.total_time_sec)}`
            : '未获得'}
        </span>
        <span className="text-slate-500">{earned ? formatDate(medal.earned_at) : ''}</span>
      </div>
    </div>
  )
}

function Header({
  onBack, title, subtitle,
}: { onBack: () => void; title: string; subtitle?: string }) {
  return (
    <div className="shrink-0 p-4 pb-2">
      <div className="max-w-5xl mx-auto">
        <button onClick={onBack} className="text-sm text-slate-400 hover:text-cyan-300 transition-colors">
          ← 返回
        </button>
        <div className="text-center mt-3 mb-2">
          <h1 className="font-hud text-2xl md:text-3xl text-cyan-400 glow-cyan">{title}</h1>
          {subtitle && <p className="text-slate-400 mt-1 text-sm">{subtitle}</p>}
        </div>
      </div>
    </div>
  )
}
