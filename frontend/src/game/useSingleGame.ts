/**
 * useSingleGame — 单局游戏逻辑 hook
 *
 * 从 Game.tsx 抽取的核心游戏状态与逻辑，供 SingleGame 组件和 Collection.tsx 复用。
 * 通过 startFn 参数化游戏初始化，通过 onGameEnd 回调拦截游戏结束（专题模式用）。
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import L from 'leaflet'
import { api, getSessionId } from '../api'
import { audioManager } from '../utils/audio'
import {
  detectIsMobileEnv,
  isNearTargetBucket,
  bReliefMinMoveKm,
  shouldTriggerCProvince,
  shouldTriggerCCity,
  isHintBlockedError,
  haversineKm,
  HINT_CREDITS_INITIAL,
} from '../utils/hint'
import { saveGameRecord } from '../utils/gameRecords'
import type { StartResponse, HintResponse, CheckViewResponse } from '../types'
import {
  CRUISE_SPEEDS_BY_MODE,
  JUMP_DISTANCES_BY_MODE,
} from './base/constants'
import type { InteractiveMapHandle } from './base/InteractiveMapBase'
import type { GameApiAdapter } from './base/types'

export interface GameEndResult {
  hit: boolean
  durationSec: number
  targetName: string
  targetPoiId?: number | null
  targetLng: number
  targetLat: number
  targetCover: string | null
  targetSummary: string | null
  distanceKm: number
  score: number
  steps: number
  totalDistanceKm: number
  // 完成时点选/专题模式的地图 zoom（用于下一点继承同等比例）
  zoom?: number
}

export interface UseSingleGameOptions {
  startFn: (startLng?: number, startLat?: number) => Promise<StartResponse>
  difficulty: string
  mode: string
  apiAdapter: GameApiAdapter
  onGameEnd?: (result: GameEndResult) => void
  variant?: 'solo' | 'collection'
  reportSession?: boolean
  gameKey?: number | string
}

export function useSingleGame(opts: UseSingleGameOptions) {
  const { startFn, difficulty, mode, apiAdapter, onGameEnd, variant = 'solo', reportSession = true, gameKey } = opts
  const isCollection = variant === 'collection'

  const isMobile = detectIsMobileEnv()
  const handleRef = useRef<InteractiveMapHandle | null>(null)
  const gameIdRef = useRef<number | null>(null)
  const endedRef = useRef(false)
  const sessionDbIdRef = useRef<number | null>(null)
  const lastTargetRef = useRef<{ lng: number; lat: number } | null>(null)
  // 最近一次 flyTo 的 zoom（easy 模式新局继承同等缩放比例）
  const lastZoomRef = useRef<number | null>(null)
  const bReliefLastPosRef = useRef<{ lng: number; lat: number } | null>(null)
  const cProvinceFiredRef = useRef(false)
  const cCityFiredRef = useRef(false)
  const coverTimerRef = useRef<number | null>(null)
  const [contributor, setContributor] = useState<string | null>(null)

  const [game, setGame] = useState<StartResponse | null>(null)
  const [error, setError] = useState('')
  const [distanceInput, setDistanceInput] = useState('50')
  const distance = useMemo(() => {
    const n = parseInt(distanceInput, 10)
    if (Number.isNaN(n) || n < 1) return 1
    return Math.min(2000, n)
  }, [distanceInput])
  const [steps, setSteps] = useState(0)
  const [totalDist, setTotalDist] = useState(0)
  const [timeLeft, setTimeLeft] = useState(0)
  const [hints, setHints] = useState<HintResponse[]>([])
  const [hintCredits, setHintCredits] = useState(HINT_CREDITS_INITIAL)
  const [easyDirHint, setEasyDirHint] = useState<string | null>(null)
  const [reliefMsg, setReliefMsg] = useState('')
  const [locationHint, setLocationHint] = useState<{ text: string; type: 'province' | 'city' } | null>(null)
  const [coverStage, setCoverStage] = useState<'big' | 'thumb' | 'hidden'>('hidden')
  const [coverPreview, setCoverPreview] = useState(false)
  const [moving, setMoving] = useState(false)
  const [missMsg, setMissMsg] = useState('')
  const [showGuide, setShowGuide] = useState(() => {
    try { return localStorage.getItem(`map_guide_dismissed_${difficulty}`) !== '1' } catch { return true }
  })
  const dismissGuide = useCallback(() => {
    try { localStorage.setItem(`map_guide_dismissed_${difficulty}`, '1') } catch {}
    setShowGuide(false)
  }, [difficulty])
  const [submitting, setSubmitting] = useState(false)
  // 游戏结束结果（仅 solo 模式用内置结算面板时使用）
  const [endedResult, setEndedResult] = useState<GameEndResult | null>(null)
  const [showResult, setShowResult] = useState(false)

  const cruiseSpeeds = game ? (CRUISE_SPEEDS_BY_MODE[game.mode] || CRUISE_SPEEDS_BY_MODE.national) : CRUISE_SPEEDS_BY_MODE.national
  const jumpDistances = game ? (JUMP_DISTANCES_BY_MODE[game.mode] || JUMP_DISTANCES_BY_MODE.national) : JUMP_DISTANCES_BY_MODE.national

  // 初始化游戏
  useEffect(() => {
    bReliefLastPosRef.current = null
    cProvinceFiredRef.current = false
    cCityFiredRef.current = false
    setEasyDirHint(null)
    setLocationHint(null)
    setReliefMsg('')
    setEndedResult(null)
    setShowResult(false)
    setGame(null)
    setError('')

    startFn()
      .then((res) => {
        gameIdRef.current = res.game_id
        setGame(res)
        setTimeLeft(res.time_limit)
        setHintCredits(res.hint_credits ?? HINT_CREDITS_INITIAL)
        endedRef.current = false
        if (res.target_cover) {
          setCoverStage('big')
          if (coverTimerRef.current) clearTimeout(coverTimerRef.current)
          coverTimerRef.current = window.setTimeout(() => setCoverStage('hidden'), 3000)
        }
        if (reportSession) {
          api.reportSession({
            session_id: getSessionId(),
            mode,
            region_code: undefined,
            category: undefined,
            difficulty,
            game_type: 'solo',
          }).then((s) => { sessionDbIdRef.current = s.id }).catch(() => {})
        }
      })
      .catch((e) => setError(e.message))
    return () => {
      if (coverTimerRef.current) { clearTimeout(coverTimerRef.current); coverTimerRef.current = null }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameKey])

  const endSessionReport = useCallback((won: boolean, score: number, durationSec: number) => {
    if (!reportSession) return
    const sid = sessionDbIdRef.current
    if (sid == null) return
    api.endSession(sid, { won, score, duration_sec: durationSec }).catch(() => {})
  }, [reportSession])

  useEffect(() => {
    if (!missMsg) return
    const t = setTimeout(() => setMissMsg(''), 2500)
    return () => clearTimeout(t)
  }, [missMsg])

  useEffect(() => {
    if (!showGuide) return
    const t = setTimeout(() => setShowGuide(false), 12000)
    return () => clearTimeout(t)
  }, [showGuide])

  const unlockZoom = useCallback((flyTo?: [number, number, number | null]) => {
    const h = handleRef.current
    const map = h?.mapRef.current
    const zoomControlRef = h?.zoomControlRef
    if (!map || !zoomControlRef) return
    map.setMinZoom(3)
    map.setMaxZoom(18)
    map.scrollWheelZoom.enable()
    map.touchZoom.enable()
    map.doubleClickZoom.enable()
    if (!zoomControlRef.current) {
      zoomControlRef.current = L.control.zoom({ position: 'bottomright' }).addTo(map)
    }
    if (flyTo) {
      const zoom = flyTo[2] ?? map.getZoom()
      lastZoomRef.current = zoom
      const targetPoint = map.project([flyTo[0], flyTo[1]], zoom)
      const isPC = window.innerWidth >= 768
      const offsetX = isPC ? 200 : 0
      const offsetY = isPC ? 0 : -Math.round(window.innerHeight * 0.3)
      const centerPoint = L.point(targetPoint.x - offsetX, targetPoint.y - offsetY)
      map.flyTo(map.unproject(centerPoint, zoom), zoom, { duration: 0.8 })
    }
  }, [])

  // 统一的"游戏结束"处理：收集结果 → 通知父组件或显示内置结算
  const finishGame = useCallback((result: GameEndResult) => {
    if (onGameEnd) {
      // 专题模式：让玩家看清高亮目标再通知父组件；本地图不缩放，无需长延迟
      const delay = isCollection ? 500 : 800
      window.setTimeout(() => {
        onGameEnd(result)
      }, delay)
    } else {
      // solo 模式：显示内置结算面板
      setEndedResult(result)
      setShowResult(true)
    }
    endSessionReport(result.hit, result.score, result.durationSec)
    if (!isCollection) {
      saveGameRecord({
        ts: Date.now(),
        mode,
        difficulty,
        hit: result.hit,
        score: result.score,
        distance_km: result.distanceKm,
        target_name: result.targetName,
        total_distance_km: result.totalDistanceKm,
        target_lng: result.targetLng || null,
        target_lat: result.targetLat || null,
        duration_sec: result.durationSec,
        target_cover: result.targetCover || null,
        contributor,
      })
    }
  }, [onGameEnd, endSessionReport, isCollection, mode, difficulty, contributor])

  const handleWin = useCallback((res: CheckViewResponse) => {
    const h = handleRef.current
    // 专题模式 + 巡航降级中命中：把"原始 zoom"改写为当前 zoom，
    // 这样 endedRef 置位后巡航循环调用的 restoreZoom 就"恢复"到当前比例（即不缩放）
    if (isCollection && h) {
      const cruise = h.cruise
      const map = h.mapRef.current
      if (cruise?.cruiseActiveRef.current && cruise.cruiseOrigZoomRef.current != null && map) {
        cruise.cruiseOrigZoomRef.current = Math.floor(map.getZoom())
      }
    }
    endedRef.current = true
    setShowGuide(false)
    audioManager.hit()
    if (h?.mapRef.current && h.pickMarkerRef.current) {
      h.mapRef.current.removeLayer(h.pickMarkerRef.current)
      h.pickMarkerRef.current = null
    }
    h?.setPicked(null)

    const map = h?.mapRef.current
    const targetMarkerRef = h?.targetMarkerRef
    const lat = res.target_lat
    const lng = res.target_lng

    if (map && targetMarkerRef && lat != null && lng != null) {
      const icon = L.divIcon({
        className: '',
        html:
          '<div class="relative w-24 h-24">' +
          '<span class="absolute inset-0 rounded-full bg-green-500/50 animate-ping"></span>' +
          '<span class="absolute inset-6 rounded-full bg-green-500 border-2 border-white shadow-lg"></span>' +
          '<span class="absolute inset-0 flex items-center justify-center text-3xl">🎯</span>' +
          '</div>',
        iconSize: [96, 96],
        iconAnchor: [48, 48],
      })
      targetMarkerRef.current = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(map)
      map.panTo([lat, lng], { animate: true, duration: 0.8 })
    }

    const delay = isCollection ? 500 : 1200
    window.setTimeout(() => {
      if (lat != null && lng != null) {
        if (isCollection) {
          // 专题模式：不改变 zoom，保持当前比例（拖拽时的缩放）
        } else {
          unlockZoom([lat, lng, difficulty === 'easy' ? 17 : null])
        }
      } else {
        unlockZoom()
      }
      setContributor(res.contributor_nickname ?? null)
      if (isCollection) {
        // 专题模式：用结算点（玩家当前位置）作为下一段起点，
        // 避免湖泊等有面积区域强制定位到中心点
        const c = map?.getCenter()
        if (c) lastTargetRef.current = { lng: c.lng, lat: c.lat }
      } else if (res.target_lng != null && res.target_lat != null) {
        lastTargetRef.current = { lng: res.target_lng, lat: res.target_lat }
      }
      finishGame({
        hit: true,
        durationSec: res.duration_sec ?? 0,
        targetName: res.target_name ?? '',
        targetPoiId: res.target_poi_id ?? null,
        targetLng: res.target_lng ?? 0,
        targetLat: res.target_lat ?? 0,
        targetCover: res.target_cover ?? null,
        targetSummary: res.target_summary ?? null,
        distanceKm: res.distance_km ?? 0,
        score: res.score ?? 0,
        steps: res.steps ?? 0,
        totalDistanceKm: res.total_distance_km ?? 0,
        zoom: isCollection && map ? Math.floor(map.getZoom()) : undefined,
      })
    }, delay)
  }, [unlockZoom, difficulty, finishGame])

  // 倒计时
  useEffect(() => {
    if (!game || showResult || endedResult) return
    const timer = setInterval(() => {
      setTimeLeft((t) => (t > 0 ? t - 1 : 0))
    }, 1000)
    return () => clearInterval(timer)
  }, [game, showResult, endedResult])

  // 倒计时归零：触发放弃
  const handleGiveUpRef = useRef<() => void>(() => {})
  useEffect(() => {
    if (game && timeLeft === 0 && !showResult && !endedResult && !endedRef.current) {
      handleGiveUpRef.current()
    }
  }, [timeLeft, game, showResult, endedResult])

  // C 救济
  useEffect(() => {
    if (!game || showResult || endedResult || difficulty === 'easy') return
    const ratio = timeLeft / game.time_limit
    if (shouldTriggerCProvince(ratio, isMobile) && !cProvinceFiredRef.current) {
      cProvinceFiredRef.current = true
      api.getLocationHint(game.game_id, 'province')
        .then((r) => {
          if (!r.in_target_province && r.current_province) {
            setLocationHint({ text: `当前所在省：${r.current_province}`, type: 'province' })
          }
        }).catch(() => {})
    }
    if (shouldTriggerCCity(ratio, isMobile) && !cCityFiredRef.current) {
      cCityFiredRef.current = true
      api.getLocationHint(game.game_id, 'city')
        .then((r) => {
          if (!r.in_target_city && r.current_city) {
            setLocationHint({ text: `当前所在市：${r.current_city}`, type: 'city' })
          }
        }).catch(() => {})
    }
  }, [timeLeft, game, showResult, endedResult, difficulty, isMobile])

  useEffect(() => {
    if (!reliefMsg) return
    const t = setTimeout(() => setReliefMsg(''), 3000)
    return () => clearTimeout(t)
  }, [reliefMsg])

  const handleMove = useCallback(async (dir: string) => {
    if (!game || moving) return
    const cruise = handleRef.current?.cruise
    if (cruise) cruise.lastDirRef.current = dir
    setMoving(true)
    try {
      const res = await apiAdapter.move(game.game_id, dir, distance)
      setSteps(res.steps ?? 0)
      setTotalDist(res.total_distance_km ?? 0)
      handleRef.current?.mapRef.current?.panTo([res.view_lat, res.view_lng], { animate: true, duration: 0.8 })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setMoving(false)
    }
  }, [game, distance, moving, apiAdapter])

  const onCheckView = useCallback((res: CheckViewResponse) => {
    if (endedRef.current) return
    if (res.hit) {
      handleWin(res)
      return
    }
    if (difficulty === 'easy') return
    if (!isNearTargetBucket(res.distance_bucket, isMobile)) return
    const map = handleRef.current?.mapRef.current
    if (!map) return
    const center = map.getCenter()
    const last = bReliefLastPosRef.current
    if (last && haversineKm(last.lng, last.lat, center.lng, center.lat) < bReliefMinMoveKm(isMobile)) return
    bReliefLastPosRef.current = { lng: center.lng, lat: center.lat }
    setReliefMsg(`🎯 快到了！距目标 ${res.distance_bucket}`)
  }, [handleWin, difficulty, isMobile])

  const handleJump = useCallback(() => {
    const cruise = handleRef.current?.cruise
    if (!cruise) return
    if (cruise.cruiseActiveRef.current) cruise.stopCruise()
    const dir = cruise.cruiseDirRef.current || cruise.lastDirRef.current
    if (!dir) { cruise.showToast('请先选择方向'); return }
    handleMove(dir)
  }, [handleMove])

  const jumpDistance = useCallback((km: number) => {
    const cruise = handleRef.current?.cruise
    if (!cruise) return
    if (cruise.cruiseActiveRef.current) cruise.stopCruise()
    const dir = cruise.cruiseDirRef.current || cruise.lastDirRef.current
    if (!dir) { cruise.showToast('请先选择方向'); return }
    if (!game || moving) return
    cruise.lastDirRef.current = dir
    setMoving(true)
    apiAdapter.move(game.game_id, dir, km)
      .then((res) => {
        setSteps(res.steps ?? 0)
        setTotalDist(res.total_distance_km ?? 0)
        handleRef.current?.mapRef.current?.panTo([res.view_lat, res.view_lng], { animate: true, duration: 0.8 })
      })
      .catch((e: any) => setError(e.message))
      .finally(() => setMoving(false))
  }, [game, moving, apiAdapter])

  const handleHint = useCallback(async (level: number) => {
    if (!game) return
    try {
      const res = await apiAdapter.getHint(game.game_id, level)
      if (typeof (res as any).hint_credits === 'number') setHintCredits((res as any).hint_credits)
      const hintRes = res as any
      if (difficulty === 'easy' && level === 2) {
        setEasyDirHint(hintRes.content ?? hintRes.hint_text)
      } else if (difficulty !== 'easy' && level === 2) {
        setHints((prev) => [...prev.filter((h) => h.hint_level !== 2), { hint_level: 2, content: hintRes.content ?? hintRes.hint_text, cost: hintRes.cost ?? 0, bounds: hintRes.bounds ?? null, hint_credits: hintRes.hint_credits ?? 0 } as HintResponse])
      } else {
        setHints((prev) => [...prev, { hint_level: level, content: hintRes.content ?? hintRes.hint_text, cost: hintRes.cost ?? 0, bounds: hintRes.bounds ?? null, hint_credits: hintRes.hint_credits ?? 0 } as HintResponse])
      }
      const map = handleRef.current?.mapRef.current
      const hintRectRef = handleRef.current?.hintRectRef
      if (difficulty !== 'easy' && hintRes.bounds && map && hintRectRef) {
        if (hintRectRef.current) map.removeLayer(hintRectRef.current)
        hintRectRef.current = L.rectangle(
          [[hintRes.bounds.south, hintRes.bounds.west], [hintRes.bounds.north, hintRes.bounds.east]],
          { color: '#eab308', weight: 2, fillOpacity: 0.1, dashArray: '6,6' }
        ).addTo(map)
      }
    } catch (e: any) {
      if (isHintBlockedError(e)) {
        handleRef.current?.cruise.showToast(e.message || '机会已用完')
      } else {
        setError(e.message)
      }
    }
  }, [game, difficulty, apiAdapter])

  const handlePickConfirm = useCallback(() => {
    const id = gameIdRef.current
    const picked = handleRef.current?.picked
    if (!id || endedRef.current || !picked || submitting) return
    setSubmitting(true)
    apiAdapter.clickTarget(id, picked.lng, picked.lat)
      .then((res: any) => {
        if (!res.hit || endedRef.current) {
          audioManager.miss()
          setMissMsg(res.distance_hint
            ? `未命中，距目标 ${res.distance_hint}，拖拽标记微调或点击别处重新放置`
            : '未命中，拖拽标记微调或点击别处重新放置')
          return
        }
        handleWin(res)
      })
      .catch(() => {})
      .finally(() => setSubmitting(false))
  }, [submitting, handleWin, apiAdapter])

  const handleGiveUp = useCallback(async () => {
    if (!game || endedRef.current) return
    endedRef.current = true
    try {
      const res: any = await apiAdapter.giveUp(game.game_id)
      const totalKm = res.total_distance_km ?? totalDist
      if (isCollection) {
        // 专题模式放弃：用当前位置作为下一段起点，而非目标定位点
        const c = handleRef.current?.mapRef.current?.getCenter()
        if (c) lastTargetRef.current = { lng: c.lng, lat: c.lat }
      } else if (res.target_lng != null && res.target_lat != null) {
        lastTargetRef.current = { lng: res.target_lng, lat: res.target_lat }
      }
      const map = handleRef.current?.mapRef.current
      const targetMarkerRef = handleRef.current?.targetMarkerRef
      if (map && targetMarkerRef && res.target_lat != null && res.target_lng != null) {
        const targetIcon = L.divIcon({
          className: '',
          html:
            '<div class="relative w-24 h-24">' +
            '<span class="absolute inset-0 rounded-full bg-green-500/50 animate-ping"></span>' +
            '<span class="absolute inset-6 rounded-full bg-green-500 border-2 border-white shadow-lg"></span>' +
            '<span class="absolute inset-0 flex items-center justify-center text-3xl">🎯</span>' +
            '</div>',
          iconSize: [96, 96],
          iconAnchor: [48, 48],
        })
        L.marker([res.target_lat, res.target_lng], { icon: targetIcon }).addTo(map)
        if (!isCollection) {
          // 非专题模式放弃：解锁缩放并飞到目标
          unlockZoom([res.target_lat, res.target_lng, difficulty === 'easy' ? 10 : null])
        }
      }
      setContributor(null)
      finishGame({
        hit: false,
        durationSec: 0,
        targetName: res.target_name ?? '',
        targetPoiId: res.target_poi_id ?? null,
        targetLng: res.target_lng ?? 0,
        targetLat: res.target_lat ?? 0,
        targetCover: res.target_cover ?? null,
        targetSummary: res.target_summary ?? null,
        distanceKm: res.distance_km ?? 0,
        score: 0,
        steps,
        totalDistanceKm: totalKm,
        zoom: isCollection && map ? Math.floor(map.getZoom()) : undefined,
      })
    } catch (e: any) {
      setError(e.message)
    }
  }, [game, totalDist, steps, difficulty, unlockZoom, finishGame, apiAdapter])

  // 让倒计时 effect 能引用最新的 handleGiveUp
  handleGiveUpRef.current = handleGiveUp

  const handleNewGame = useCallback(() => {
    // 记录当前地图 zoom，新局继承同等比例
    const currentZoom = handleRef.current?.mapRef.current?.getZoom()
    if (currentZoom != null) lastZoomRef.current = currentZoom

    setShowResult(false)
    setEndedResult(null)
    try { setShowGuide(localStorage.getItem(`map_guide_dismissed_${difficulty}`) !== '1') } catch { setShowGuide(true) }
    setContributor(null)
    setSubmitting(false)
    bReliefLastPosRef.current = null
    cProvinceFiredRef.current = false
    cCityFiredRef.current = false
    setEasyDirHint(null)
    setLocationHint(null)
    setReliefMsg('')
    const lastTarget = lastTargetRef.current
    startFn(lastTarget?.lng, lastTarget?.lat).then((res) => {
      gameIdRef.current = res.game_id
      endedRef.current = false
      setGame(res)
      setTimeLeft(res.time_limit)
      setSteps(0)
      setTotalDist(0)
      setHints([])
      setHintCredits(res.hint_credits ?? HINT_CREDITS_INITIAL)
      if (res.target_cover) {
        setCoverStage('big')
        if (coverTimerRef.current) clearTimeout(coverTimerRef.current)
        coverTimerRef.current = window.setTimeout(() => setCoverStage('hidden'), 3000)
      } else {
        setCoverStage('hidden')
      }
      if (reportSession) {
        api.reportSession({
          session_id: getSessionId(),
          mode,
          region_code: undefined,
          category: undefined,
          difficulty,
          game_type: 'solo',
        }).then((s) => { sessionDbIdRef.current = s.id }).catch(() => {})
      }
    })
  }, [difficulty, mode, startFn, reportSession])

  const formatTime = useCallback((s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }, [])

  return {
    // refs
    handleRef,
    gameIdRef,
    endedRef,
    lastTargetRef,
    lastZoomRef,
    // state
    game,
    error,
    distanceInput,
    setDistanceInput,
    distance,
    steps,
    totalDist,
    setTotalDist,
    timeLeft,
    hints,
    hintCredits,
    easyDirHint,
    reliefMsg,
    locationHint,
    coverStage,
    setCoverStage,
    coverPreview,
    setCoverPreview,
    moving,
    missMsg,
    showGuide,
    dismissGuide,
    submitting,
    contributor,
    showResult,
    endedResult,
    cruiseSpeeds,
    jumpDistances,
    isMobile,
    // handlers
    handleMove,
    handleJump,
    jumpDistance,
    handleHint,
    handleWin,
    onCheckView,
    handleGiveUp,
    handlePickConfirm,
    handleNewGame,
    unlockZoom,
    formatTime,
  }
}

export type UseSingleGameReturn = ReturnType<typeof useSingleGame>
