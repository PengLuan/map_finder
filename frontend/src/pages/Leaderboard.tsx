/**
 * Leaderboard — 排行榜
 * 三个 Tab：勋章数量排行 / 单个专题排行 / 单个 POI 排行
 */
import { useState, useEffect, useCallback } from 'react'
import {
  collectionApi, isLoggedIn,
  type CollectionGroup, type LeaderboardRow, type SearchPoiItem,
} from '../api/collection'

interface Props { onBack: () => void }
type Tab = 'single' | 'poi' | 'medal_count'

const TABS: { key: Tab; label: string }[] = [
  { key: 'medal_count', label: '勋章数量排行' },
  { key: 'single', label: '单个专题排行' },
  { key: 'poi', label: '单个 POI 排行' },
]

function formatTime(sec: number | null): string {
  if (sec == null) return '—'
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('zh-CN') } catch { return '—' }
}

function rankColor(rank: number): string {
  if (rank === 1) return 'text-yellow-300'
  if (rank === 2) return 'text-slate-200'
  if (rank === 3) return 'text-amber-600'
  return 'text-slate-400'
}

function rankBg(rank: number): string {
  if (rank === 1) return 'bg-yellow-500/15 border-yellow-500/40'
  if (rank === 2) return 'bg-slate-400/15 border-slate-300/40'
  if (rank === 3) return 'bg-amber-700/15 border-amber-600/40'
  return 'bg-slate-800/50 border-slate-700'
}

const RANK_BADGES = ['🥇', '🥈', '🥉']

export default function Leaderboard({ onBack }: Props) {
  const [tab, setTab] = useState<Tab>('medal_count')
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'all' | 'easy' | 'hard'>('all')
  const [groups, setGroups] = useState<CollectionGroup[]>([])
  const [collectionId, setCollectionId] = useState<number | null>(null)
  const [difficulty, setDifficulty] = useState<'easy' | 'hard'>('easy')
  const [poiKeyword, setPoiKeyword] = useState('')
  const [poiResults, setPoiResults] = useState<SearchPoiItem[]>([])
  const [selectedPoi, setSelectedPoi] = useState<SearchPoiItem | null>(null)

  useEffect(() => {
    collectionApi.list().then((res) => {
      setGroups(res.data.groups)
      const first = res.data.groups.flatMap((g) => g.collections)[0]
      if (first) setCollectionId(first.id)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (tab !== 'poi' || poiKeyword.trim().length < 2) {
      setPoiResults([])
      return
    }
    const timer = window.setTimeout(() => {
      collectionApi.searchPois(poiKeyword.trim()).then((res) => setPoiResults(res.data)).catch(() => setPoiResults([]))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [tab, poiKeyword])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = tab === 'medal_count'
        ? await collectionApi.leaderboardMedalCount(100, mode === 'all' ? undefined : mode)
        : tab === 'single'
          ? await collectionApi.leaderboardSingle(collectionId!, difficulty)
          : await collectionApi.leaderboardPoi(selectedPoi!.id, difficulty)
      setRows(res.data)
    } catch (e: any) { setError(e.message || '加载失败') }
    finally { setLoading(false) }
  }, [tab, mode, collectionId, difficulty, selectedPoi])

  useEffect(() => {
    if (tab === 'medal_count' || (tab === 'single' && collectionId != null) || (tab === 'poi' && selectedPoi != null)) load()
  }, [load, tab, collectionId, selectedPoi])

  const allCollections = groups.flatMap((g) => g.collections)
  const valueLabel = tab === 'medal_count' ? '勋章数' : tab === 'single' ? '专题用时' : '单点用时'

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      <div className="shrink-0 p-4 pb-2">
        <div className="max-w-3xl mx-auto">
          <button onClick={onBack} className="text-sm text-slate-400 hover:text-cyan-300 transition-colors">← 返回</button>
          <div className="text-center mt-3 mb-3">
            <h1 className="font-hud text-2xl md:text-3xl text-cyan-400 glow-cyan">🏆 排行榜</h1>
          </div>
          <div className="flex gap-2 justify-center">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)} className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${tab === t.key ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>{t.label}</button>
            ))}
          </div>
          {(tab === 'single' || tab === 'poi') && (
            <div className="mt-3 flex flex-wrap gap-2 justify-center items-center">
              {tab === 'single' && (
                <select value={collectionId ?? ''} onChange={(e) => setCollectionId(Number(e.target.value))} className="px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white outline-none focus:border-cyan-400 max-w-[180px]">
                  {allCollections.length === 0 && <option value="">暂无专题</option>}
                  {allCollections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
              {tab === 'poi' && (
                <div className="relative w-full max-w-[280px]">
                  <input value={poiKeyword} onChange={(e) => { setPoiKeyword(e.target.value); setSelectedPoi(null) }} placeholder="搜索任意 POI 名称" className="w-full px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white outline-none focus:border-cyan-400" />
                  {poiResults.length > 0 && !selectedPoi && <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-600 rounded-lg overflow-hidden shadow-xl">{poiResults.map((poi) => <button key={poi.id} onClick={() => { setSelectedPoi(poi); setPoiKeyword(poi.name); setPoiResults([]) }} className="block w-full text-left px-3 py-2 hover:bg-slate-700 text-sm text-white"><div>{poi.name}</div>{poi.address && <div className="text-xs text-slate-400 truncate">{poi.address}</div>}</button>)}</div>}
                </div>
              )}
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as 'easy' | 'hard')} className="px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white outline-none focus:border-cyan-400">
                <option value="easy">点选</option><option value="hard">巡航</option>
              </select>
              {!isLoggedIn() && <span className="text-xs text-amber-300">需要登录才能上榜</span>}
            </div>
          )}
          {tab === 'medal_count' && (
            <div className="mt-3 flex gap-2 justify-center">
              {(['all', 'easy', 'hard'] as const).map((m) => <button key={m} onClick={() => setMode(m)} className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${mode === m ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>{m === 'all' ? '全部' : m === 'easy' ? '点选' : '巡航'}</button>)}
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 pt-2 min-h-0">
        <div className="max-w-3xl mx-auto">
          {loading && <div className="text-center text-slate-400 py-10">加载中...</div>}
          {error && <div className="text-center text-red-400 py-10">{error}</div>}
          {!loading && !error && rows.length === 0 && <div className="text-center text-slate-400 py-10">暂无排行数据</div>}
          {!loading && !error && rows.length > 0 && <div className="space-y-2">
            <div className="grid grid-cols-12 gap-2 px-3 py-1.5 text-xs text-slate-500"><div className="col-span-2">排名</div><div className="col-span-5">昵称</div><div className="col-span-3 text-right">{valueLabel}</div><div className="col-span-2 text-right">日期</div></div>
            {rows.map((r) => <div key={`${r.rank}-${r.user_id}`} className={`grid grid-cols-12 gap-2 px-3 py-2.5 rounded-lg border items-center ${rankBg(r.rank)}`}>
              <div className={`col-span-2 font-bold ${rankColor(r.rank)}`}>{r.rank <= 3 ? RANK_BADGES[r.rank - 1] : `#${r.rank}`}</div>
              <div className="col-span-5 text-sm truncate">
                {r.profile_public === false ? (
                  <span className="text-white/70">{r.nickname} 🔒</span>
                ) : (
                  <button
                    onClick={() => { window.location.hash = `#/user/${r.user_id}` }}
                    className="text-white text-left hover:text-cyan-300 transition-colors"
                    title="查看用户主页"
                  >{r.nickname}</button>
                )}
              </div>
              <div className="col-span-3 text-right text-sm text-cyan-300">{tab === 'medal_count' ? (r.medal_count ?? 0) : formatTime(tab === 'single' ? r.total_time_sec : (r.poi_time_sec ?? null))}</div>
              <div className="col-span-2 text-right text-xs text-slate-500">{formatDate(r.earned_at)}</div>
            </div>)}
          </div>}
        </div>
      </div>
    </div>
  )
}
