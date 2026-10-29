/**
 * UserProfile — 用户公开主页（第四期）
 * 基本信息（头像/昵称/slogan/勋章总数/加入时间）+ 勋章墙 + 足迹地图
 * 路由：#/user/:id；隐私关闭时显示"该用户已隐藏主页"（本人可见自己的）
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import L from 'leaflet'
import {
  authApi, collectionApi,
  type UserProfileInfo, type MedalWallGroup, type MedalWallItem, type TrackPoint,
} from '../api/collection'
import { addTileLayers } from '../game/base/tileLayers'
import { PICK_ICON } from '../game/base/constants'

interface Props {
  userId: number
  onBack: () => void
}

const TIERS = [
  { min: 1, max: 2, label: '入门', stars: '★1-2' },
  { min: 3, max: 4, label: '进阶', stars: '★3-4' },
  { min: 5, max: 6, label: '精通', stars: '★5-6' },
  { min: 7, max: 8, label: '大师', stars: '★7-8' },
]

function formatTime(sec: number | null): string {
  if (sec == null) return '—'
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

function difficultyLabel(d: string): string {
  return d === 'easy' ? '点选' : d === 'hard' ? '巡航' : d
}

export default function UserProfile({ userId, onBack }: Props) {
  const [profile, setProfile] = useState<UserProfileInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'medals' | 'tracks'>('medals')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await authApi.userProfile(userId)
      setProfile(res)
    } catch (e: any) {
      setError(e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { load() }, [load])

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 overflow-y-auto">
      <div className="shrink-0 p-4 pb-2">
        <div className="max-w-3xl mx-auto">
          <button onClick={onBack} className="text-sm text-slate-400 hover:text-cyan-300 transition-colors">← 返回</button>
        </div>
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-slate-400">加载中...</div>}
      {error && <div className="flex-1 flex items-center justify-center text-red-400">{error}</div>}

      {/* 隐私关闭提示页 */}
      {!loading && !error && profile?.hidden && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-5xl mb-3">🔒</div>
            <p className="text-slate-300 font-bold mb-1">该用户已隐藏主页</p>
            <p className="text-xs text-slate-500">TA 选择不公开自己的游戏足迹与勋章</p>
          </div>
        </div>
      )}

      {!loading && !error && profile && !profile.hidden && (
        <div className="pb-6">
          <div className="max-w-3xl mx-auto px-4">
            {/* 基本信息卡片 */}
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-5 flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-slate-700/60 flex items-center justify-center overflow-hidden shrink-0">
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt={profile.nickname} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl">👤</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-lg font-bold text-white truncate">{profile.nickname}</h1>
                  {profile.profile_public === false && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-600/40 text-slate-400">主页已隐藏</span>
                  )}
                </div>
                {profile.slogan && (
                  <p className="text-sm text-cyan-300/90 mt-0.5 break-words">{profile.slogan}</p>
                )}
                <p className="text-xs text-slate-500 mt-1">
                  🏅 {profile.total_medals ?? 0} 枚勋章 · {profile.created_at ? `${profile.created_at} 加入` : ''}
                </p>
              </div>
            </div>

            {/* Tab 切换 */}
            <div className="flex gap-2 justify-center mt-4 mb-3">
              <button
                onClick={() => setTab('medals')}
                className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${tab === 'medals' ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
              >
                🎖️ 勋章墙
              </button>
              <button
                onClick={() => setTab('tracks')}
                className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${tab === 'tracks' ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
              >
                🗺️ 足迹
              </button>
            </div>

            {tab === 'medals' ? (
              <ProfileMedals userId={userId} />
            ) : (
              <ProfileTracks userId={userId} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** 他人视角勋章墙：复用勋章墙合并逻辑与卡片样式 */
function ProfileMedals({ userId }: { userId: number }) {
  const [groups, setGroups] = useState<MedalWallGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'all' | 'easy' | 'hard'>('all')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await collectionApi.medalWall(userId, mode === 'all' ? undefined : mode)
      // 合并同专题+难度的 solo/pk 勋章：二者达成其一即显示已获得，取最快用时
      const merged: MedalWallGroup[] = res.data.map((g) => {
        const map = new Map<string, MedalWallItem>()
        for (const m of g.medals) {
          const key = `${m.collection_id}-${m.difficulty}`
          const existing = map.get(key)
          if (!existing) {
            map.set(key, { ...m })
          } else if (m.earned) {
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
  }, [userId, mode])

  useEffect(() => { load() }, [load])

  const tiered = TIERS.map((t) => ({
    ...t,
    medals: groups
      .filter((g) => g.star >= t.min && g.star <= t.max)
      .flatMap((g) => g.medals)
      .sort((a, b) => Number(b.earned) - Number(a.earned)),
  }))
  const totalEarned = tiered.flatMap((t) => t.medals).filter((m) => m.earned).length

  return (
    <div>
      <div className="flex gap-2 justify-center mb-4">
        {(['all', 'easy', 'hard'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${mode === m ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
          >
            {m === 'all' ? '全部' : m === 'easy' ? '点选' : '巡航'}
          </button>
        ))}
      </div>
      {loading && <div className="text-center text-slate-400 py-10">加载中...</div>}
      {error && <div className="text-center text-red-400 py-10">{error}</div>}
      {!loading && !error && (
        <>
          <p className="text-center text-xs text-slate-500 mb-4">已获得 {totalEarned} 枚勋章</p>
          {tiered.map((t) => (
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
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {t.medals.map((m) => <ProfileMedalCard key={`${m.collection_id}-${m.difficulty}`} medal={m} />)}
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function ProfileMedalCard({ medal }: { medal: MedalWallItem }) {
  const earned = medal.earned
  return (
    <div className={`p-3 rounded-xl border ${earned ? 'border-amber-500/40 bg-slate-800/70' : 'border-slate-700 bg-slate-800/30 opacity-60'}`}>
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-lg bg-slate-700/60 flex items-center justify-center shrink-0 overflow-hidden">
          {medal.icon_url ? (
            <img src={medal.icon_url} alt={medal.collection_name} className={`w-full h-full object-cover ${earned ? '' : 'grayscale'}`} />
          ) : (
            <span className="text-2xl">{earned ? '🏅' : '🔒'}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-white text-sm truncate">{medal.collection_name}</div>
          <div className="text-xs text-cyan-400 mt-0.5">{difficultyLabel(medal.difficulty)}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className="text-amber-300">
          {earned && medal.total_time_sec != null ? `⏱ ${formatTime(medal.total_time_sec)}` : '未获得'}
        </span>
        <span className="text-slate-500">{earned ? (medal.earned_at ?? '') : ''}</span>
      </div>
    </div>
  )
}

/** 他人足迹：地图打点 + 列表（坐标不脱敏） */
function ProfileTracks({ userId }: { userId: number }) {
  const [points, setPoints] = useState<TrackPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markersRef = useRef<L.Marker[]>([])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    collectionApi.tracks(userId)
      .then((res) => { if (!cancelled) setPoints(res.data) })
      .catch((e) => { if (!cancelled) setError(e.message || '加载失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [userId])

  // 初始化地图
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return
    const map = L.map(containerRef.current, {
      center: [35, 105],
      zoom: 4,
      worldCopyJump: true,
      zoomControl: false,
    })
    addTileLayers(map)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // 渲染标记点
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    markersRef.current.forEach((m) => map.removeLayer(m))
    markersRef.current = []

    const latlngs: L.LatLngTuple[] = []
    points.forEach((p) => {
      const m = L.marker([p.lat, p.lng], { icon: PICK_ICON }).addTo(map)
      m.bindTooltip(p.name, {
        permanent: true,
        direction: 'top',
        offset: [0, -42],
        className: 'track-point-label text-center',
      })
      const coverUrl = p.cover_url || p.collection_cover_url
      const cover = coverUrl
        ? `<img src="${coverUrl}" alt="${p.name}" style="width:100%; height:120px; object-fit:cover; border-radius:8px 8px 0 0;" />`
        : ''
      m.bindPopup(
        `<div style="width:220px; margin:-13px -19px -15px; overflow:hidden;">${cover}` +
        `<div style="padding:10px 12px;"><div style="font-weight:bold; font-size:15px; margin-bottom:4px;">${p.name}</div>` +
        `<div style="font-size:12px; color:#64748b; margin-bottom:6px;">${p.collection_name || '自由探索'}</div>` +
        `${p.summary ? `<div style="font-size:12px; line-height:1.5; color:#475569;">${p.summary}</div>` : ''}</div></div>`
      )
      markersRef.current.push(m)
      latlngs.push([p.lat, p.lng])
    })
    if (latlngs.length > 1) {
      map.fitBounds(latlngs, { padding: [40, 40] })
    } else if (latlngs.length === 1) {
      map.setView(latlngs[0], 12)
    }
  }, [points])

  // 注意：DOM 结构必须稳定（地图容器始终渲染，状态做成覆盖层），
  // 否则 loading 结束后 React 会重建容器 div，Leaflet 实例挂在被移除的旧节点上导致底图不可见
  return (
    <div>
      <div className="relative rounded-xl overflow-hidden border border-slate-700/60 h-[360px]">
        <div ref={containerRef} className="absolute inset-0" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-[1100] bg-slate-900/60">
            <span className="text-cyan-300">加载中...</span>
          </div>
        )}
        {!loading && error && (
          <div className="absolute inset-0 flex items-center justify-center z-[1100] bg-slate-900/80">
            <span className="text-red-400">{error}</span>
          </div>
        )}
        {!loading && !error && (
          <>
            <span className="absolute top-2 right-2 z-[1000] text-xs text-slate-300 bg-slate-900/70 px-2 py-1 rounded-lg">
              {points.length} 个点位
            </span>
            {points.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center z-[900] pointer-events-none">
                <div className="bg-slate-800/90 px-6 py-4 rounded-xl border border-slate-700 text-center">
                  <div className="text-3xl mb-2">🗺️</div>
                  <p className="text-slate-300 text-sm">还没有收集记录</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
