/**
 * NewsTimeline — 新闻时间线找点玩法（点选 / 巡航）
 * 复用游戏引擎（SingleGame + InteractiveMapBase + useSingleGame），
 * 巡航/点选交互、提示分级、仪表盘、救济等与自由/专题模式完全一致；
 * 新闻特有：提示卡常驻、命中解锁新闻卡片、找齐回顾面板、纪念勋章、事件纠错反馈。
 * 两种模式进度独立（各自找齐、各发勋章）。
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import L from 'leaflet'
import { newsApi } from '../api/news'
import type {
  NewsTimelineDetail, NewsPoiUnlocked, NewsSummary, NewsFoundResponse,
} from '../api/news'
import { SingleGame } from '../game/SingleGame'
import { useSingleGame } from '../game/useSingleGame'
import type { GameEndResult } from '../game/useSingleGame'
import type { GameApiAdapter } from '../game/base/types'
import type { InteractiveMapHandle } from '../game/base/InteractiveMapBase'
import type { StartResponse } from '../types'

interface Props {
  code: string
  onBack: () => void
}

type Phase = 'loading' | 'select' | 'playing'
type Mode = 'easy' | 'hard'

// 新闻找点容差（与后端 news_tolerance_km 一致）
const newsToleranceKm = (difficulty: number) => Math.max(5, difficulty * 4)

export default function NewsTimeline({ code, onBack }: Props) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [difficulty, setDifficulty] = useState<Mode>('easy')
  const [detail, setDetail] = useState<NewsTimelineDetail | null>(null)
  const [summary, setSummary] = useState<NewsSummary | null>(null)
  const [showSummary, setShowSummary] = useState(false)
  const [error, setError] = useState('')
  const [hitPoi, setHitPoi] = useState<NewsPoiUnlocked | null>(null)
  // 找齐时的勋章横幅（登录用户发勋章；游客提示登录）
  const [medalBanner, setMedalBanner] = useState<{ awarded: boolean; icon: string | null; name: string } | null>(null)
  // 事件纠错弹窗
  const [correctionPoi, setCorrectionPoi] = useState<{ id: number; name: string } | null>(null)
  // 引擎单局 key（命中后推进下一事件时重建）
  const [gameKey, setGameKey] = useState(0)

  const detailRef = useRef<NewsTimelineDetail | null>(null)
  const modeRef = useRef<Mode>('easy')
  const lastFoundRef = useRef<NewsFoundResponse | null>(null)
  const creditsRef = useRef(100)
  const sgHandleHolder = useRef<InteractiveMapHandle | null>(null)
  detailRef.current = detail
  modeRef.current = difficulty

  // 刷新当前模式进度
  const refreshDetail = useCallback((mode: Mode) => {
    return newsApi.detail(code, mode).then((res) => setDetail(res.data)).catch(() => {})
  }, [code])

  // 初始化（默认点选视角，供模式选择页展示双进度）
  useEffect(() => {
    newsApi
      .detail(code, 'easy')
      .then((res) => {
        setDetail(res.data)
        setPhase('select')
      })
      .catch((e: Error) => setError(e.message || '加载时间线失败'))
  }, [code])

  // 命中后：更新进度 + 弹新闻卡片（地图 marker 由游戏引擎 handleWin 处理）
  const applyHit = useCallback((found: NewsFoundResponse) => {
    const poi = found.poi
    if (!poi) return
    setHitPoi(poi)
    setMedalBanner(
      found.completed
        ? { awarded: !!found.medal_awarded, icon: found.medal_icon_url ?? null, name: found.medal_name ?? '纪念勋章' }
        : null,
    )
    setDetail((prev) => {
      if (!prev) return prev
      const points = prev.points.map((p) => (p.id === poi.id ? { ...poi, found: true } : p))
      return {
        ...prev,
        points,
        found_count: found.found_count ?? prev.found_count,
        current: found.next ?? null,
        completed: found.completed ?? false,
      }
    })
  }, [])

  // 引擎开局：新闻 StartResponse（对齐自由模式：北京中心开局、每事件时限）
  // 提示直接给定位地名（地图找点，不猜词）；地名取事件名"｜"前段
  const startFn = useCallback((_sl?: number, _sla?: number): Promise<StartResponse> => {
    const d = detailRef.current
    if (!d?.current) return Promise.reject(new Error('该模式下已全部找齐'))
    const loc = d.current.location ?? ''
    const region = d.current.region ? `（${d.current.region}）` : ''
    return Promise.resolve({
      game_id: d.current.id,
      mode: 'national',
      difficulty: modeRef.current,
      start_lng: d.start_lng ?? 116.397,
      start_lat: d.start_lat ?? 39.908,
      time_limit: d.time_limit ?? 300,
      tolerance_km: newsToleranceKm(d.current.difficulty),
      hint_text: `${loc}${region}`,
      target_cover: null,
      hint_credits: creditsRef.current,
      device: window.innerWidth >= 768 ? 'pc' : 'mobile',
    })
  }, [])

  // 新闻适配器：把游戏引擎的移动/判定/提示接到新闻接口（无状态）
  const newsAdapter = useMemo<GameApiAdapter>(() => ({
    move: (_gid, direction, distanceKm) => {
      const c = sgHandleHolder.current?.mapRef.current?.getCenter()
      if (!c) return Promise.reject(new Error('地图未就绪'))
      return newsApi.move(code, c.lng, c.lat, direction, distanceKm) as any
    },
    updateView: () => Promise.resolve(),
    checkView: (_gid, west, south, east, north) => {
      return newsApi.checkView(code, west, south, east, north, modeRef.current).then((res) => {
        const d = res.data
        if (d.hit) lastFoundRef.current = d
        return {
          hit: d.hit,
          distance_bucket: d.distance_bucket,
          target_name: d.poi?.name,
          target_lng: d.poi?.lng,
          target_lat: d.poi?.lat,
          target_summary: d.poi?.event_text ?? null,
          target_cover: d.poi?.cover_url ?? null,
        } as any
      })
    },
    clickTarget: (_gid, lng, lat) => {
      const cur = detailRef.current?.current
      if (!cur) return Promise.reject(new Error('该模式下已全部找齐'))
      return newsApi.found(code, cur.id, lng, lat, modeRef.current).then((res) => {
        const d = res.data
        if (d.hit) lastFoundRef.current = d
        return {
          hit: d.hit,
          distance_hint: d.hit ? undefined : `约 ${d.distance_km} km`,
          target_name: d.poi?.name ?? '',
          target_lng: d.poi?.lng,
          target_lat: d.poi?.lat,
          target_summary: d.poi?.event_text ?? null,
          target_cover: d.poi?.cover_url ?? null,
        } as any
      })
    },
    getHint: (_gid, level) => {
      const c = sgHandleHolder.current?.mapRef.current?.getCenter()
      const cur = detailRef.current?.current
      return newsApi.hint(
        code, c?.lng ?? 116.397, c?.lat ?? 39.908, level,
        modeRef.current,
        window.innerWidth >= 768 ? 'pc' : 'mobile',
        creditsRef.current, cur?.id,
      ).then((res) => {
        const d = res.data as any
        if (typeof d.hint_credits === 'number') creditsRef.current = d.hint_credits
        return d
      })
    },
    giveUp: () => Promise.resolve({ success: false } as any),
  }), [code])

  // 引擎回调：命中 → 新闻卡片；放弃/超时 → 回模式选择（进度保留）
  const handleGameEnd = useCallback((result: GameEndResult) => {
    if (result.hit) {
      const found = lastFoundRef.current
      if (found?.hit) {
        applyHit(found)
        return
      }
    }
    // 未命中（放弃/超时）：进度保留，回模式选择
    setPhase('select')
    setHitPoi(null)
    setMedalBanner(null)
    refreshDetail(modeRef.current)
  }, [applyHit, code, refreshDetail])

  const sg = useSingleGame({
    startFn,
    difficulty,
    mode: 'national',
    apiAdapter: newsAdapter,
    onGameEnd: handleGameEnd,
    variant: 'collection',
    reportSession: false,
    gameKey,
  })
  // 引擎地图句柄转发（适配器取当前视野中心用）
  sgHandleHolder.current = sg.handleRef.current

  // 继续下一事件：重建引擎单局
  const handleNextEvent = useCallback(() => {
    setHitPoi(null)
    setMedalBanner(null)
    setGameKey((k) => k + 1)
  }, [])

  const openSummary = useCallback((mode: Mode = (detailRef.current?.mode ?? 'easy')) => {
    newsApi
      .summary(code, mode)
      .then((res) => {
        setSummary(res.data)
        setShowSummary(true)
        setHitPoi(null)
        setMedalBanner(null)
        // 地图视野调整为能看齐全部事件标注（右侧让出回顾面板宽度）
        const map = sg.handleRef.current?.mapRef.current
        const pts = res.data.points
          .filter((p) => 'lng' in p)
          .map((p) => [p.lat, p.lng] as [number, number])
        if (map && pts.length) {
          map.fitBounds(L.latLngBounds(pts), {
            paddingTopLeft: [60, 80],
            paddingBottomRight: [480, 60],
            maxZoom: 7,
          })
        }
      })
      .catch((e: Error) => setError(e.message))
  }, [code, sg.handleRef])

  // 选定模式：加载该模式的独立进度后进入地图
  const startMode = useCallback((mode: Mode) => {
    setDifficulty(mode)
    if (detailRef.current?.mode === mode) {
      setPhase('playing')
      return
    }
    newsApi
      .detail(code, mode)
      .then((res) => {
        setDetail(res.data)
        setPhase('playing')
      })
      .catch((e: Error) => setError(e.message))
  }, [code])

  const handleExitToSelect = useCallback(() => {
    setPhase('select')
    setHitPoi(null)
    setMedalBanner(null)
    refreshDetail(modeRef.current)
  }, [refreshDetail])

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-900">
        <div className="text-center">
          <p className="text-rose-400 mb-4">{error}</p>
          <button onClick={onBack} className="px-6 py-2 bg-slate-700 rounded-lg hover:bg-slate-600">
            返回
          </button>
        </div>
      </div>
    )
  }

  const color = detail?.color ?? '#22d3ee'

  // ===== 完整回顾：模式选择页（无地图）直接打开全屏回顾 =====
  if (phase === 'select' && detail && showSummary && summary) {
    return (
      <div className="h-full overflow-y-auto bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
        <div className="max-w-2xl mx-auto p-4 pt-5 pb-10">
          <button onClick={() => setShowSummary(false)} className="text-sm text-slate-400 hover:text-cyan-300">
            ← 返回
          </button>
          <div className="text-center my-4">
            <div className="text-3xl mb-1">🎉</div>
            <h1 className="font-bold text-xl" style={{ color: summary.color ?? color }}>{summary.name}</h1>
            <p className="text-xs text-slate-400 mt-1">时间线找齐 · 完整回顾</p>
          </div>
          <SummaryContent summary={summary} color={color} onBackToColumn={onBack} />
        </div>
      </div>
    )
  }

  // ===== 模式选择视图 =====
  if (phase === 'select' && detail) {
    const easyFound = detail.mode === 'easy' ? detail.found_count : (detail.other_found_easy ?? 0)
    const hardFound = detail.mode === 'hard' ? detail.found_count : (detail.other_found_hard ?? 0)
    const easyDone = detail.point_count > 0 && easyFound >= detail.point_count
    const hardDone = detail.point_count > 0 && hardFound >= detail.point_count
    return (
      <div className="h-full overflow-y-auto bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
        <div className="max-w-2xl mx-auto p-4 pt-5 pb-10">
          <button onClick={onBack} className="text-sm text-slate-400 hover:text-cyan-300">← 返回栏目</button>

          {/* 封面 */}
          <div className="relative rounded-2xl overflow-hidden mt-4 h-48 md:h-56 border border-slate-700">
            {detail.cover_url ? (
              <img src={detail.cover_url} alt={detail.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full" style={{ background: `linear-gradient(135deg, ${color} 0%, #1f2937 100%)` }} />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-slate-900/95 via-slate-900/30 to-transparent" />
            <div className="absolute bottom-3 left-4 right-4">
              <h1 className="font-bold text-xl md:text-2xl text-white drop-shadow">{detail.name}</h1>
              <p className="text-xs text-slate-300/90 mt-1">
                {detail.point_count} 个事件 · 🌱 {easyFound}/{detail.point_count} · 🔥 {hardFound}/{detail.point_count}
              </p>
            </div>
          </div>
          {detail.description && (
            <p className="text-sm text-slate-300 leading-relaxed mt-3">{detail.description}</p>
          )}

          {/* 模式选择：两种模式进度独立，各自找齐、各发勋章 */}
          <p className="text-sm text-slate-400 mt-5 mb-2 font-bold">选择玩法</p>
          <div className="grid grid-cols-2 gap-3">
            {([['easy', easyFound, easyDone], ['hard', hardFound, hardDone]] as const).map(([m, found, done]) => {
              const isEasy = m === 'easy'
              return (
                <button
                  key={m}
                  onClick={() => (done ? openSummary(m) : startMode(m))}
                  className={`relative p-4 rounded-xl border-2 bg-slate-800/60 hover:bg-slate-800 transition-all text-left ${
                    isEasy
                      ? done ? 'border-emerald-400 bg-slate-800' : 'border-emerald-500/40 hover:border-emerald-400'
                      : done ? 'border-orange-400 bg-slate-800' : 'border-orange-500/40 hover:border-orange-400'
                  }`}
                >
                  {done && (
                    <span className={`absolute top-2.5 right-2.5 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      isEasy ? 'bg-emerald-500/20 text-emerald-300' : 'bg-orange-500/20 text-orange-300'
                    }`}>
                      ✓ 已找齐
                    </span>
                  )}
                  <div className="text-2xl mb-1.5">{isEasy ? '🌱' : '🔥'}</div>
                  <div className={`font-bold ${isEasy ? 'text-emerald-300' : 'text-orange-300'}`}>
                    {isEasy ? '点选模式' : '巡航模式'}
                  </div>
                  <div className="text-xs text-slate-400 mt-1 leading-relaxed">
                    {isEasy ? '点击地图标记事件发生地，容差内命中' : '方向键移动视野搜索，视野盖住事件发生地即命中'}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-2">
                    进度 {found}/{detail.point_count} · {done ? '查看回顾' : '开始找点'}
                  </div>
                </button>
              )
            })}
          </div>
          {(easyDone || hardDone) && (
            <button
              onClick={() => openSummary(easyDone ? 'easy' : 'hard')}
              className="w-full mt-5 py-3 rounded-xl font-bold text-sm text-white shadow-lg"
              style={{ background: color }}
            >
              🎉 已找齐！查看完整回顾 →
            </button>
          )}
        </div>
      </div>
    )
  }

  // ===== 地图找点视图（游戏引擎） =====
  const title = detail ? `📰 ${detail.name} ${detail.found_count}/${detail.point_count}` : undefined

  return (
    <div className="relative h-full">
      <SingleGame
        key={gameKey}
        startFn={startFn}
        difficulty={difficulty}
        mode="national"
        apiAdapter={newsAdapter}
        onGameEnd={handleGameEnd}
        onBack={handleExitToSelect}
        gameKey={gameKey}
        variant="collection"
        title={title}
      />

      {/* 命中：新闻卡片 */}
      {hitPoi && (
        <div className="absolute inset-0 z-[2000] bg-slate-900/85 backdrop-blur-sm flex items-end md:items-center justify-center p-4">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 shadow-2xl max-w-md w-full overflow-hidden max-h-[85vh] overflow-y-auto">
            {hitPoi.cover_url && (
              <img src={hitPoi.cover_url} alt={hitPoi.name} className="w-full h-44 object-cover" />
            )}
            <div className="p-5">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className="text-2xl">✅</span>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: `${color}33`, color }}>
                  {hitPoi.event_date} · {hitPoi.region ?? '目标区域'}
                </span>
              </div>
              <h3 className="text-lg font-bold text-white leading-snug">{hitPoi.name}</h3>
              {hitPoi.event_text && (
                <p className="text-sm text-slate-200 leading-relaxed mt-2">{hitPoi.event_text}</p>
              )}
              {hitPoi.fact_text && (
                <p className="text-xs text-slate-400 leading-relaxed mt-3 bg-slate-900/60 rounded-lg p-3">
                  💡 地理冷知识：{hitPoi.fact_text}
                </p>
              )}
              {medalBanner && (
                medalBanner.awarded ? (
                  <div className="mt-3 flex items-center gap-3 rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-900/40 to-amber-800/40 p-3">
                    <div className="w-12 h-12 rounded-lg bg-slate-900/60 flex items-center justify-center overflow-hidden shrink-0">
                      {medalBanner.icon ? (
                        <img src={medalBanner.icon} alt={medalBanner.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-2xl">🏅</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-amber-300">🏅 获得纪念勋章</p>
                      <p className="text-xs text-amber-200/80 truncate">{medalBanner.name} · 可在勋章墙查看</p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-900/20 p-3 text-center">
                    <p className="text-xs text-amber-200">🏅 登录后可领取完成时间线的纪念勋章</p>
                  </div>
                )
              )}
              <button
                onClick={() => setCorrectionPoi({ id: hitPoi.id, name: hitPoi.name })}
                className="w-full mt-3 py-1.5 text-xs text-slate-500 hover:text-slate-300 rounded-lg transition-colors"
              >
                ✎ 地点信息有误？反馈此事件
              </button>
              {!detail?.current ? (
                <button
                  onClick={() => { setHitPoi(null); setMedalBanner(null); openSummary() }}
                  className="w-full mt-2 py-3 rounded-xl font-bold text-sm text-white transition-colors"
                  style={{ background: color }}
                >
                  🎉 时间线找齐！查看完整回顾 →
                </button>
              ) : (
                <button
                  onClick={handleNextEvent}
                  className="w-full mt-2 py-3 rounded-xl font-bold text-sm text-white transition-colors"
                  style={{ background: color }}
                >
                  继续找下一个事件 →
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 完整回顾：右侧悬浮面板，背景地图常驻可见 */}
      {showSummary && summary && (
        <div className="absolute inset-y-0 right-0 z-[1900] w-full md:w-[440px] bg-slate-900/95 backdrop-blur-md border-l border-slate-700 shadow-2xl flex flex-col">
          <div className="shrink-0 px-4 pt-4 pb-3 border-b border-slate-800 flex items-start justify-between gap-2">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-11 h-11 rounded-lg bg-slate-800 flex items-center justify-center overflow-hidden shrink-0 border border-amber-500/40">
                {summary.medal_icon_url ? (
                  <img
                    src={summary.medal_icon_url}
                    alt="勋章"
                    className={`w-full h-full object-cover ${summary.medal_awarded ? '' : 'grayscale opacity-60'}`}
                  />
                ) : (
                  <span className="text-xl">{summary.medal_awarded ? '🏅' : '🔒'}</span>
                )}
              </div>
              <div className="min-w-0">
                <h2 className="font-bold text-base truncate" style={{ color: summary.color ?? color }}>{summary.name}</h2>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  时间线找齐 · 完整回顾
                  {summary.medal_awarded && <span className="text-amber-300"> · 🏅 勋章已入墙</span>}
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowSummary(false)}
              className="text-slate-400 hover:text-white text-2xl leading-none px-2"
              title="回到地图"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <SummaryContent summary={summary} color={color} onBackToColumn={onBack} />
          </div>
        </div>
      )}

      {/* 事件纠错反馈弹窗 */}
      {correctionPoi && (
        <NewsCorrectionModal
          poiId={correctionPoi.id}
          poiName={correctionPoi.name}
          onClose={() => setCorrectionPoi(null)}
        />
      )}
    </div>
  )
}

// ===== 回顾内容（右侧面板 / 全屏回顾共用） =====

function SummaryContent({ summary, color, onBackToColumn }: {
  summary: NewsSummary
  color: string
  onBackToColumn: () => void
}) {
  const [correctionPoi, setCorrectionPoi] = useState<{ id: number; name: string } | null>(null)
  return (
    <div className="px-4 py-4">
      <div className="relative pl-6 space-y-4">
        <div className="absolute left-2 top-2 bottom-2 w-0.5" style={{ background: `${color}55` }} />
        {summary.points.map((p, i) => (
          <div key={p.id} className="relative">
            <span
              className="absolute -left-[18px] top-2 w-4 h-4 rounded-full border-2 border-slate-900"
              style={{ background: color }}
            >
              <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-slate-900">{i + 1}</span>
            </span>
            <div className="bg-slate-800/80 rounded-2xl border border-slate-700 overflow-hidden">
              {p.cover_url && (
                <img src={p.cover_url} alt={p.name} className="w-full h-32 object-cover" loading="lazy" />
              )}
              <div className="p-3.5">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: `${color}33`, color }}>
                    {p.event_date}
                  </span>
                  <h3 className="font-bold text-white text-sm">{p.name}</h3>
                </div>
                {p.event_text && <p className="text-sm text-slate-200 leading-relaxed mt-1">{p.event_text}</p>}
                {p.fact_text && (
                  <p className="text-xs text-slate-400 leading-relaxed mt-2 bg-slate-900/60 rounded-lg p-2.5">
                    💡 {p.fact_text}
                  </p>
                )}
                {p.link_url && (
                  <a
                    href={`/news/link?to=${encodeURIComponent(p.link_url)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-2.5 px-4 py-1.5 rounded-lg text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white"
                  >
                    阅读原报道 ↗{p.link_source ? `（${p.link_source}）` : ''}
                  </a>
                )}
                <button
                  onClick={() => setCorrectionPoi({ id: p.id, name: p.name })}
                  className="mt-2 w-full py-1.5 text-xs text-slate-500 hover:text-slate-300 rounded-lg transition-colors"
                >
                  ✎ 地点信息有误？反馈此事件
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <button
        onClick={onBackToColumn}
        className="w-full mt-5 py-3 rounded-xl font-bold text-sm bg-slate-700 hover:bg-slate-600 text-white"
      >
        返回栏目
      </button>

      {correctionPoi && (
        <NewsCorrectionModal
          poiId={correctionPoi.id}
          poiName={correctionPoi.name}
          onClose={() => setCorrectionPoi(null)}
        />
      )}
    </div>
  )
}

// ===== 事件纠错反馈弹窗 =====

function NewsCorrectionModal({ poiId, poiName, onClose }: {
  poiId: number
  poiName: string
  onClose: () => void
}) {
  const [content, setContent] = useState('')
  const [contact, setContact] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const submit = () => {
    if (!content.trim()) {
      setError('请填写反馈内容')
      return
    }
    setSubmitting(true)
    setError('')
    newsApi.submitCorrection(poiId, content.trim(), contact.trim() || undefined)
      .then(() => setDone(true))
      .catch((e: Error) => setError(e.message || '提交失败'))
      .finally(() => setSubmitting(false))
  }

  return (
    <div className="absolute inset-0 z-[2100] bg-slate-900/85 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 rounded-2xl border border-slate-700 shadow-2xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-2">🙏</div>
            <p className="text-white font-bold mb-1">反馈已提交</p>
            <p className="text-xs text-slate-400 mb-4">感谢帮助改进，我们会尽快核实处理</p>
            <button onClick={onClose} className="px-6 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm font-bold">
              知道了
            </button>
          </div>
        ) : (
          <>
            <h3 className="font-bold text-white mb-1">反馈地点信息</h3>
            <p className="text-xs text-slate-400 mb-3 truncate">事件：{poiName}</p>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value.slice(0, 500))}
              rows={4}
              placeholder="请描述问题（如名称/位置/介绍有误），500 字以内"
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm text-slate-200 placeholder:text-slate-600 resize-none"
            />
            <div className="text-right text-[10px] text-slate-600 mb-2">{content.length}/500</div>
            <input
              value={contact}
              onChange={(e) => setContact(e.target.value.slice(0, 100))}
              placeholder="联系方式（选填，便于回访）"
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm text-slate-200 placeholder:text-slate-600 mb-3"
            />
            {error && <p className="text-rose-400 text-xs mb-2">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={submit}
                disabled={submitting}
                className="flex-1 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-xl text-sm font-bold"
              >
                {submitting ? '提交中...' : '提交反馈'}
              </button>
              <button onClick={onClose} className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-sm">
                取消
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
