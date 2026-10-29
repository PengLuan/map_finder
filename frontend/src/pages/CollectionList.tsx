/**
 * CollectionList — 专题列表页
 * 按星级分组（可折叠），锁/解锁状态正确（FE-05）
 */
import { useState, useEffect, useCallback } from 'react'
import {
  collectionApi,
  isLoggedIn,
  type CollectionGroup,
  type MedalWallItem,
} from '../api/collection'
import AuthModal from '../components/AuthModal'

interface Props {
  onBack: () => void
  onOpen: (code: string) => void
}

const STAR_LABEL: Record<number, string> = {
  1: '新手', 2: '进阶', 3: '中级', 4: '中高级',
  5: '高级', 6: '挑战', 7: '困难', 8: '终极',
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function CollectionList({ onBack, onOpen }: Props) {
  const [groups, setGroups] = useState<CollectionGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [showAuth, setShowAuth] = useState(false)
  const [unlockMessage, setUnlockMessage] = useState('')
  const [medals, setMedals] = useState<Map<number, MedalWallItem[]>>(new Map())

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await collectionApi.list()
      setGroups(res.data.groups)
      if (isLoggedIn()) {
        const medalRes = await collectionApi.medalWall()
        const byCollection = new Map<number, Map<string, MedalWallItem>>()
        for (const group of medalRes.data) {
          for (const medal of group.medals) {
            let byDifficulty = byCollection.get(medal.collection_id)
            if (!byDifficulty) {
              byDifficulty = new Map()
              byCollection.set(medal.collection_id, byDifficulty)
            }
            const existing = byDifficulty.get(medal.difficulty)
            if (!existing) {
              byDifficulty.set(medal.difficulty, { ...medal })
            } else if (medal.earned && (!existing.earned
              || (medal.total_time_sec != null
                && (existing.total_time_sec == null || medal.total_time_sec < existing.total_time_sec)))) {
              byDifficulty.set(medal.difficulty, { ...medal })
            }
          }
        }
        setMedals(new Map(
          Array.from(byCollection, ([collectionId, byDifficulty]) => [
            collectionId,
            Array.from(byDifficulty.values()),
          ])
        ))
      } else {
        setMedals(new Map())
      }
    } catch (e: any) {
      setError(e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = (star: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(star)) next.delete(star)
      else next.add(star)
      return next
    })
  }

  const handleClick = (code: string, unlocked: boolean, unlockRequire: number, star: number) => {
    if (!unlocked) {
      setUnlockMessage(`需要先完成 ${unlockRequire} 个 ★${star - 1} 专题`)
      window.setTimeout(() => setUnlockMessage(''), 2200)
      return
    }
    onOpen(code)
  }

  const medalCount = isLoggedIn()
    ? Array.from(medals.values()).flat().filter((medal) => medal.earned).length
    : 0

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      {/* 顶部 */}
      <div className="shrink-0 p-4 pb-2">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between">
            <button onClick={onBack} className="text-sm text-slate-400 hover:text-cyan-300 transition-colors">
              ← 返回首页
            </button>
            <div className="flex items-center gap-3">
              {isLoggedIn() ? (
                <span className="text-xs text-cyan-300">🎖 {medalCount} 勋章</span>
              ) : (
                <button onClick={() => setShowAuth(true)} className="text-xs text-slate-400 hover:text-cyan-300">
                  登录领勋章
                </button>
              )}
            </div>
          </div>
          <div className="text-center mt-3 mb-2">
            <h1 className="font-hud text-2xl md:text-3xl text-cyan-400 glow-cyan">🗺️ 专题模式</h1>
            <p className="text-slate-400 mt-1 text-sm">按顺序收集多个地点，集齐获得勋章</p>
          </div>
        </div>
      </div>

      {unlockMessage && (
        <div className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-amber-500/50 bg-slate-900/95 px-4 py-2 text-xs text-amber-200 shadow-2xl">
          🔒 {unlockMessage}
        </div>
      )}

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto p-4 pt-2 min-h-0">
        <div className="max-w-5xl mx-auto">
          {loading && <div className="text-center text-slate-400 py-10">加载中...</div>}
          {error && <div className="text-center text-red-400 py-10">{error}</div>}
          {!loading && !error && groups.length === 0 && (
            <div className="text-center text-slate-400 py-10">暂无专题</div>
          )}
          {!loading && groups.map((g) => {
            const isCollapsed = collapsed.has(g.star)
            const starReq = g.star > 1 ? (g.collections[0]?.unlock_require ?? 0) : 0
            return (
              <div key={g.star} className="mb-4">
                <button
                  onClick={() => toggle(g.star)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-slate-800/60 rounded-xl border border-slate-700 hover:border-cyan-500/40"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-amber-400 text-sm">{'★'.repeat(Math.min(g.star, 5))}</span>
                    <span className="font-bold text-white">★{g.star} {STAR_LABEL[g.star] || ''}</span>
                    <span className="text-xs text-slate-400">
                      ({g.collections.length} 个专题)
                    </span>
                  </div>
                  <div className="text-xs text-slate-400">
                    {g.star === 1 ? '默认开放' : `已完成 ${g.completed}/${starReq}`}
                  </div>
                </button>
                {!isCollapsed && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
                    {g.collections.map((c) => {
                      const locked = !c.unlocked
                      const earnedMedals = (medals.get(c.id) ?? []).filter((m) => m.earned)
                      return (
                        <button
                          key={c.id}
                          onClick={() => handleClick(c.code, c.unlocked, c.unlock_require ?? 0, g.star)}
                          className={`relative text-left p-3 rounded-xl border-2 transition-all ${
                            locked
                              ? 'border-slate-700 bg-slate-800/40 opacity-60 cursor-not-allowed'
                              : 'border-slate-600 bg-slate-800/60 hover:border-cyan-400 hover:shadow-lg hover:shadow-cyan-500/10'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="w-14 h-14 rounded-lg bg-slate-700 overflow-hidden flex items-center justify-center shrink-0">
                              {c.cover_url ? (
                                <img src={c.cover_url} alt={c.name} className="w-full h-full object-cover" />
                              ) : (
                                <span className="text-2xl">{c.icon || '🗺️'}</span>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="font-bold text-white text-sm truncate">{c.name}</div>
                              <div className="text-xs text-slate-400 mt-0.5">
                                {c.point_count} 个点位
                                {c.geometry && <span className="ml-1 text-cyan-400">· {c.geometry}</span>}
                              </div>
                            </div>
                          </div>
                          {locked && (
                            <div className="absolute top-2 right-2 text-lg">🔒</div>
                          )}
                          {locked && g.star > 1 && (
                            <div className="text-[10px] text-slate-500 mt-1">
                              完成 {starReq} 个 ★{g.star - 1} 解锁
                            </div>
                          )}
                          {earnedMedals.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-amber-500/20 text-[11px] text-amber-300">
                              {earnedMedals.map((medal) => (
                                <div key={medal.difficulty}>
                                  🎖 已获：{medal.difficulty === 'easy' ? '点选' : '巡航'}
                                  {medal.total_time_sec != null && ` · 最快 ${formatTime(medal.total_time_sec)}`}
                                </div>
                              ))}
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {showAuth && (
        <AuthModal
          onClose={() => setShowAuth(false)}
          onSuccess={() => { setShowAuth(false); load() }}
        />
      )}
    </div>
  )
}
