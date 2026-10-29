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
  creditsTextClass,
  hintCostText,
  haversineKm,
  HINT_CREDITS_INITIAL,
} from '../utils/hint'
import { saveGameRecord } from '../utils/gameRecords'
import type { StartResponse, SelectResponse, HintResponse, CheckViewResponse } from '../types'
import {
  CRUISE_SPEEDS_BY_MODE,
  JUMP_DISTANCES_BY_MODE,
} from '../game/base/constants'
import { InteractiveMapBase } from '../game/base/InteractiveMapBase'
import type { InteractiveMapHandle } from '../game/base/InteractiveMapBase'
import { soloApiAdapter } from '../game/adapters/soloApiAdapter'
import { EasyModePanel } from '../game/easy/EasyModePanel'
import { HardModePanel } from '../game/hard/HardModePanel'
import { CoverImage } from '../game/shared/CoverImage'
import { GuideModal } from '../game/shared/GuideModal'
import { GameResultPanel } from '../game/shared/GameResultPanel'

interface Props {
  mode: string
  regionCode?: string
  difficulty: string
  category?: string
  onBack: () => void
}

export default function Game({ mode, regionCode, difficulty, category, onBack }: Props) {
  // 设备识别：PC 弱化 / 移动强化（提示频次/精度/时长/视觉钩子分维度差异）
  const isMobile = detectIsMobileEnv()
  // InteractiveMapBase 句柄（render prop 中赋值，回调中通过 ref 访问）
  const handleRef = useRef<InteractiveMapHandle | null>(null)
  const gameIdRef = useRef<number | null>(null)
  const endedRef = useRef(false)
  const sessionDbIdRef = useRef<number | null>(null)
  // 上一局目标坐标（再来一局时作为新局起点）
  const lastTargetRef = useRef<{ lng: number; lat: number } | null>(null)
  // 上一局结束时的 zoom（easy 模式新局继承同等缩放比例，避免回到初始细节放大）
  const lastZoomRef = useRef<number | null>(null)
  // B 救济防抖：记录上次触发位置，移动 ≥ 阈值才能再触发
  const bReliefLastPosRef = useRef<{ lng: number; lat: number } | null>(null)
  // C 救济：省/市提示各触发一次
  const cProvinceFiredRef = useRef(false)
  const cCityFiredRef = useRef(false)
  // 开局封面 3 秒大图定时器
  const coverTimerRef = useRef<number | null>(null)
  const [contributor, setContributor] = useState<string | null>(null)

  const [game, setGame] = useState<StartResponse | null>(null)
  const [error, setError] = useState('')
  const [distanceInput, setDistanceInput] = useState('50')
  // 实际生效的移动距离：解析输入并限制在 1~2000 km
  const distance = useMemo(() => {
    const n = parseInt(distanceInput, 10)
    if (Number.isNaN(n) || n < 1) return 1
    return Math.min(2000, n)
  }, [distanceInput])
  const [steps, setSteps] = useState(0)
  const [totalDist, setTotalDist] = useState(0)
  const [timeLeft, setTimeLeft] = useState(0)
  const [hints, setHints] = useState<HintResponse[]>([])
  // 提示系统：积分（机会）/ 简单方向气泡 / B救济toast / C救济省市 / A救济方位 / 开局封面
  const [hintCredits, setHintCredits] = useState(HINT_CREDITS_INITIAL)
  const [easyDirHint, setEasyDirHint] = useState<string | null>(null)
  const [reliefMsg, setReliefMsg] = useState('')
  const [locationHint, setLocationHint] = useState<{ text: string; type: 'province' | 'city' } | null>(null)
  // 开局目标封面图：big 大图 / thumb 移动缩略图常驻 / hidden 隐藏
  const [coverStage, setCoverStage] = useState<'big' | 'thumb' | 'hidden'>('hidden')
  const [coverPreview, setCoverPreview] = useState(false)
  const [result, setResult] = useState<SelectResponse | null>(null)
  const [showResult, setShowResult] = useState(false)
  const [moving, setMoving] = useState(false)
  // 简单模式点击未命中提示
  const [missMsg, setMissMsg] = useState('')
  // 开局玩法引导（按难度记忆"不再提示"）
  const [showGuide, setShowGuide] = useState(() => {
    try { return localStorage.getItem(`map_guide_dismissed_${difficulty}`) !== '1' } catch { return true }
  })
  const dismissGuide = useCallback(() => {
    try { localStorage.setItem(`map_guide_dismissed_${difficulty}`, '1') } catch {}
    setShowGuide(false)
  }, [difficulty])
  const [submitting, setSubmitting] = useState(false)

  // 按模式选择巡航速度与快捷距离（单局内模式固定）
  const cruiseSpeeds = game ? (CRUISE_SPEEDS_BY_MODE[game.mode] || CRUISE_SPEEDS_BY_MODE.national) : CRUISE_SPEEDS_BY_MODE.national
  const jumpDistances = game ? (JUMP_DISTANCES_BY_MODE[game.mode] || JUMP_DISTANCES_BY_MODE.national) : JUMP_DISTANCES_BY_MODE.national

  // 初始化游戏
  useEffect(() => {
    // 重置救济/封面状态（新一局）
    bReliefLastPosRef.current = null
    cProvinceFiredRef.current = false
    cCityFiredRef.current = false
    setEasyDirHint(null)
    setLocationHint(null)
    setReliefMsg('')

    api.startGame(mode, regionCode, difficulty, category, isMobile ? 'mobile' : 'pc')
      .then((res) => {
        gameIdRef.current = res.game_id
        setGame(res)
        setTimeLeft(res.time_limit)
        setHintCredits(res.hint_credits ?? HINT_CREDITS_INITIAL)
        // 开局目标封面图（双端都展示 3 秒大图）
        if (res.target_cover) {
          setCoverStage('big')
          if (coverTimerRef.current) clearTimeout(coverTimerRef.current)
          coverTimerRef.current = window.setTimeout(() => {
            setCoverStage('hidden')
          }, 3000)
        }
        // 上报玩家会话（无登录行为统计）
        api
          .reportSession({
            session_id: getSessionId(),
            mode,
            region_code: regionCode,
            category,
            difficulty,
            game_type: 'solo',
          })
          .then((s) => { sessionDbIdRef.current = s.id })
          .catch(() => {})
      })
      .catch((e) => setError(e.message))
    return () => {
      if (coverTimerRef.current) { clearTimeout(coverTimerRef.current); coverTimerRef.current = null }
    }
  }, [mode, regionCode, difficulty, category, isMobile])

  // 结束会话上报
  const endSessionReport = useCallback((won: boolean, score: number, durationSec: number) => {
    const sid = sessionDbIdRef.current
    if (sid == null) return
    api.endSession(sid, { won, score, duration_sec: durationSec }).catch(() => {})
  }, [])

  // 未命中提示自动消失
  useEffect(() => {
    if (!missMsg) return
    const t = setTimeout(() => setMissMsg(''), 2500)
    return () => clearTimeout(t)
  }, [missMsg])

  // 引导自动消失
  useEffect(() => {
    if (!showGuide) return
    const t = setTimeout(() => setShowGuide(false), 12000)
    return () => clearTimeout(t)
  }, [showGuide])

  // 结算时解锁地图缩放，方便玩家看清目标位置
  const unlockZoom = useCallback((flyTo?: [number, number, number | null]) => {
    const map = handleRef.current?.mapRef.current
    const zoomControlRef = handleRef.current?.zoomControlRef
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
      // PC：地图中心左偏 200px，目标显示在画面右侧，结算面板在左侧（互不遮挡）
      // 移动：结算面板为底部 sheet，地图中心下偏使目标上移至屏幕上半部分（互不遮挡）
      // zoom 传 null 时保持当前缩放级别（困难模式结算不改放大系数）
      const zoom = flyTo[2] ?? map.getZoom()
      const targetPoint = map.project([flyTo[0], flyTo[1]], zoom)
      const isPC = window.innerWidth >= 768
      const offsetX = isPC ? 200 : 0
      const offsetY = isPC ? 0 : -Math.round(window.innerHeight * 0.3)
      const centerPoint = L.point(targetPoint.x - offsetX, targetPoint.y - offsetY)
      map.flyTo(map.unproject(centerPoint, zoom), zoom, { duration: 1.6 })
    }
  }, [])

  // 目标进入视野：高亮目标点 → 平滑居中 → 宣布胜利
  const handleWin = useCallback((res: CheckViewResponse) => {
    endedRef.current = true
    setShowGuide(false)
    audioManager.hit()
    const h = handleRef.current
    // 清除落点标记
    if (h?.mapRef.current && h.pickMarkerRef.current) {
      h.mapRef.current.removeLayer(h.pickMarkerRef.current)
      h.pickMarkerRef.current = null
    }
    h?.setPicked(null)

    const map = h?.mapRef.current
    const targetMarkerRef = h?.targetMarkerRef
    const lat = res.target_lat
    const lng = res.target_lng

    // 1. 高亮目标点，并将视野中心平滑移动到目标
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

    // 2. 先让玩家看清高亮目标与居中动画，再解锁缩放并弹出结算面板
    window.setTimeout(() => {
      if (lat != null && lng != null) {
        unlockZoom([lat, lng, difficulty === 'easy' ? 17 : null])
      } else {
        unlockZoom()
      }
      setContributor(res.contributor_nickname ?? null)
      if (res.target_lng != null && res.target_lat != null) {
        lastTargetRef.current = { lng: res.target_lng, lat: res.target_lat }
      }
      setResult({
        hit: true,
        distance_km: res.distance_km ?? 0,
        score: res.score ?? 0,
        target_name: res.target_name ?? '',
        target_poi_id: res.target_poi_id ?? null,
        target_lng: res.target_lng ?? 0,
        target_lat: res.target_lat ?? 0,
        target_summary: res.target_summary ?? null,
        target_cover: res.target_cover ?? null,
        duration_sec: res.duration_sec ?? 0,
        steps: res.steps ?? 0,
        total_distance_km: res.total_distance_km ?? 0,
      })
      endSessionReport(true, res.score ?? 0, res.duration_sec ?? 0)
      saveGameRecord({
        ts: Date.now(),
        mode,
        difficulty,
        hit: true,
        score: res.score ?? 0,
        distance_km: res.distance_km ?? 0,
        target_name: res.target_name ?? '',
        total_distance_km: res.total_distance_km ?? 0,
        target_lng: res.target_lng ?? null,
        target_lat: res.target_lat ?? null,
        duration_sec: res.duration_sec ?? 0,
        target_cover: res.target_cover ?? null,
        contributor: res.contributor_nickname ?? null,
      })
      setShowResult(true)
    }, 1800)
  }, [unlockZoom, endSessionReport, difficulty])

  // 倒计时：仅递减，不在 updater 里调副作用
  useEffect(() => {
    if (!game || showResult) return
    const timer = setInterval(() => {
      setTimeLeft((t) => (t > 0 ? t - 1 : 0))
    }, 1000)
    return () => clearInterval(timer)
  }, [game, showResult])

  // 倒计时归零：触发放弃结算（独立 effect，避免在 setState updater 里调副作用）
  useEffect(() => {
    if (game && timeLeft === 0 && !showResult && !endedRef.current) {
      handleGiveUp()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, game, showResult])

  // C 救济：按剩余时间比例触发省/市提示（仅困难模式，不消耗积分，各触发一次）
  useEffect(() => {
    if (!game || showResult || difficulty === 'easy') return
    const ratio = timeLeft / game.time_limit
    if (shouldTriggerCProvince(ratio, isMobile) && !cProvinceFiredRef.current) {
      cProvinceFiredRef.current = true
      api
        .getLocationHint(game.game_id, 'province')
        .then((r) => {
          if (!r.in_target_province && r.current_province) {
            setLocationHint({ text: `当前所在省：${r.current_province}`, type: 'province' })
          }
        })
        .catch(() => {})
    }
    if (shouldTriggerCCity(ratio, isMobile) && !cCityFiredRef.current) {
      cCityFiredRef.current = true
      api
        .getLocationHint(game.game_id, 'city')
        .then((r) => {
          if (!r.in_target_city && r.current_city) {
            // 市提示更精细，覆盖省提示
            setLocationHint({ text: `当前所在市：${r.current_city}`, type: 'city' })
          }
        })
        .catch(() => {})
    }
  }, [timeLeft, game, showResult, difficulty, isMobile])

  // B 救济 toast 自动消失（3 秒）
  useEffect(() => {
    if (!reliefMsg) return
    const t = setTimeout(() => setReliefMsg(''), 3000)
    return () => clearTimeout(t)
  }, [reliefMsg])

  // A 救济方位 toast 已删除（与 level 2 方位提示重复）

  const handleMove = useCallback(
    async (dir: string) => {
      if (!game || moving) return
      const cruise = handleRef.current?.cruise
      if (cruise) cruise.lastDirRef.current = dir
      setMoving(true)
      try {
        const res = await api.move(game.game_id, dir, distance)
        setSteps(res.steps)
        setTotalDist(res.total_distance_km)
        // 平滑移动地图
        handleRef.current?.mapRef.current?.panTo([res.view_lat, res.view_lng], {
          animate: true,
          duration: 0.8,
        })
      } catch (e: any) {
        setError(e.message)
      } finally {
        setMoving(false)
      }
    },
    [game, distance, moving]
  )

  // 视野判定统一回调：命中则胜利；未命中且临近目标触发 B 救济（仅困难模式，3 秒 toast，防抖）
  const onCheckView = useCallback((res: CheckViewResponse) => {
    if (endedRef.current) return
    if (res.hit) {
      handleWin(res)
      return
    }
    // B 救济：仅困难模式；distance_bucket 临近阈值时弹"快到了"
    if (difficulty === 'easy') return
    if (!isNearTargetBucket(res.distance_bucket, isMobile)) return
    const map = handleRef.current?.mapRef.current
    if (!map) return
    const center = map.getCenter()
    const last = bReliefLastPosRef.current
    // 防抖：上次触发后需再移动 ≥ 阈值（移动 5km / PC 10km）才能再触发
    if (last && haversineKm(last.lng, last.lat, center.lng, center.lat) < bReliefMinMoveKm(isMobile)) {
      return
    }
    bReliefLastPosRef.current = { lng: center.lng, lat: center.lat }
    setReliefMsg(`🎯 快到了！距目标 ${res.distance_bucket}`)
  }, [handleWin, difficulty, isMobile])

  // 距离跳转：沿当前/上次方向直接移动指定 km（走后端 move）
  const handleJump = useCallback(() => {
    const cruise = handleRef.current?.cruise
    if (!cruise) return
    if (cruise.cruiseActiveRef.current) cruise.stopCruise()
    const dir = cruise.cruiseDirRef.current || cruise.lastDirRef.current
    if (!dir) { cruise.showToast('请先选择方向'); return }
    handleMove(dir)
  }, [handleMove])

  // 快捷距离跳转：沿当前方向直接移动指定 km
  const jumpDistance = useCallback((km: number) => {
    const cruise = handleRef.current?.cruise
    if (!cruise) return
    if (cruise.cruiseActiveRef.current) cruise.stopCruise()
    const dir = cruise.cruiseDirRef.current || cruise.lastDirRef.current
    if (!dir) { cruise.showToast('请先选择方向'); return }
    if (!game || moving) return
    cruise.lastDirRef.current = dir
    setMoving(true)
    api
      .move(game.game_id, dir, km)
      .then((res) => {
        setSteps(res.steps)
        setTotalDist(res.total_distance_km)
        handleRef.current?.mapRef.current?.panTo([res.view_lat, res.view_lng], { animate: true, duration: 0.8 })
      })
      .catch((e: any) => setError(e.message))
      .finally(() => setMoving(false))
  }, [game, moving])

  // 提示按钮：困难模式保留 level 1-4（level 4 画黄色矩形）；简单模式 level 2 改为方向气泡刷新不画矩形
  const handleHint = async (level: number) => {
    if (!game) return
    try {
      const res = await api.getHint(game.game_id, level)
      // 更新剩余积分
      if (typeof res.hint_credits === 'number') setHintCredits(res.hint_credits)
      // 简单模式 level 2：方向气泡刷新最新内容（不 append）
      // 困难模式 level 2：方位可反复调用，只保留最新一条（替换旧的 level 2）
      if (difficulty === 'easy' && level === 2) {
        setEasyDirHint(res.content)
      } else if (difficulty !== 'easy' && level === 2) {
        setHints((prev) => [...prev.filter((h) => h.hint_level !== 2), res])
      } else {
        setHints((prev) => [...prev, res])
      }
      // 仅困难模式 level 4 画黄色矩形（简单模式不再画范围框）
      const map = handleRef.current?.mapRef.current
      const hintRectRef = handleRef.current?.hintRectRef
      if (difficulty !== 'easy' && res.bounds && map && hintRectRef) {
        if (hintRectRef.current) map.removeLayer(hintRectRef.current)
        hintRectRef.current = L.rectangle(
          [
            [res.bounds.south, res.bounds.west],
            [res.bounds.north, res.bounds.east],
          ],
          { color: '#eab308', weight: 2, fillOpacity: 0.1, dashArray: '6,6' }
        ).addTo(map)
      }
    } catch (e: any) {
      // 403（积分不足/配额超限）：toast 提示，不弹红色错误窗
      if (isHintBlockedError(e)) {
        handleRef.current?.cruise.showToast(e.message || '机会已用完')
      } else {
        setError(e.message)
      }
    }
  }

  // 困难 A 救济（handleBearingHint）已删除：与 level 2 方位提示功能重复

  // 简单模式：确认落点，提交判定
  const handlePickConfirm = useCallback(() => {
    const id = gameIdRef.current
    const picked = handleRef.current?.picked
    if (!id || endedRef.current || !picked || submitting) return
    setSubmitting(true)
    api
      .clickTarget(id, picked.lng, picked.lat)
      .then((res) => {
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
  }, [submitting, handleWin])

  // 主动放弃
  const handleGiveUp = async () => {
    if (!game || endedRef.current) return
    endedRef.current = true
    try {
      const res = await api.giveUp(game.game_id)
      // 优先用后端累计的 total_distance_km（含巡航/拖拽），回退到前端 totalDist
      const totalKm = (res as any).total_distance_km ?? totalDist
      if (res.target_lng != null && res.target_lat != null) {
        lastTargetRef.current = { lng: res.target_lng, lat: res.target_lat }
      }
      setResult({
        hit: false,
        distance_km: res.distance_km,
        score: 0,
        target_name: res.target_name,
        target_poi_id: res.target_poi_id ?? null,
        target_lng: res.target_lng,
        target_lat: res.target_lat,
        target_summary: res.target_summary,
        target_cover: res.target_cover,
        duration_sec: 0,
        steps,
        total_distance_km: totalKm,
      })
      setShowResult(true)
      setContributor(null)
      endSessionReport(false, 0, 0)
      saveGameRecord({
        ts: Date.now(),
        mode,
        difficulty,
        hit: false,
        score: 0,
        distance_km: res.distance_km,
        target_name: res.target_name,
        total_distance_km: totalKm,
        target_lng: res.target_lng ?? null,
        target_lat: res.target_lat ?? null,
        duration_sec: 0,
        target_cover: res.target_cover ?? null,
        contributor: null,
      })
      const map = handleRef.current?.mapRef.current
      const targetMarkerRef = handleRef.current?.targetMarkerRef
      if (map && targetMarkerRef) {
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
        // 解锁缩放并飞到目标，展示区域全貌（可自由放大看细节）
        unlockZoom([res.target_lat, res.target_lng, difficulty === 'easy' ? 10 : null])
      }
    } catch (e: any) {
      setError(e.message)
    }
  }

  // 再来一局：重置所有状态并启动新对局（key 变化触发 InteractiveMapBase 重建）
  const handleNewGame = useCallback(() => {
    // 记录当前地图 zoom，新局继承同等比例
    const currentZoom = handleRef.current?.mapRef.current?.getZoom()
    if (currentZoom != null) lastZoomRef.current = currentZoom

    setShowResult(false)
    setResult(null)
    // 仅在未 dismiss 时显示玩法引导（尊重 localStorage 记忆）
    try { setShowGuide(localStorage.getItem(`map_guide_dismissed_${difficulty}`) !== '1') } catch { setShowGuide(true) }
    setContributor(null)
    setSubmitting(false)
    // 重置提示系统/救济/封面状态（新一局）
    bReliefLastPosRef.current = null
    cProvinceFiredRef.current = false
    cCityFiredRef.current = false
    setEasyDirHint(null)
    setLocationHint(null)
    setReliefMsg('')
    // 重新开始同模式（从上一局目标点开始，key 变化触发 InteractiveMapBase 重建）
    const lastTarget = lastTargetRef.current
    api.startGame(mode, regionCode, difficulty, category, isMobile ? 'mobile' : 'pc',
      lastTarget?.lng, lastTarget?.lat).then((res) => {
      gameIdRef.current = res.game_id
      endedRef.current = false
      setGame(res)
      setTimeLeft(res.time_limit)
      setSteps(0)
      setTotalDist(0)
      setHints([])
      setHintCredits(res.hint_credits ?? HINT_CREDITS_INITIAL)
      // 开局目标封面图
      if (res.target_cover) {
        setCoverStage('big')
        if (coverTimerRef.current) clearTimeout(coverTimerRef.current)
        coverTimerRef.current = window.setTimeout(() => {
          setCoverStage('hidden')
        }, 3000)
      } else {
        setCoverStage('hidden')
      }
      api
        .reportSession({
          session_id: getSessionId(),
          mode,
          region_code: regionCode,
          category,
          difficulty,
          game_type: 'solo',
        })
        .then((s) => { sessionDbIdRef.current = s.id })
        .catch(() => {})
    })
  }, [mode, regionCode, difficulty, category, isMobile])

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  if (error && !game) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-900">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button onClick={onBack} className="px-6 py-2 bg-slate-700 rounded-lg hover:bg-slate-600">
            返回
          </button>
        </div>
      </div>
    )
  }

  if (!game) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-900">
        <div className="animate-pulse text-cyan-400 text-lg">正在生成目标...</div>
      </div>
    )
  }

  return (
    <InteractiveMapBase
      key={game.game_id}
      startLng={game.start_lng}
      startLat={game.start_lat}
      mode={game.mode}
      difficulty={game.difficulty}
      initZoom={lastZoomRef.current ?? undefined}
      gameIdRef={gameIdRef}
      endedRef={endedRef}
      apiAdapter={soloApiAdapter}
      cruiseSpeeds={cruiseSpeeds}
      onCheckView={onCheckView}
      setTotalDist={setTotalDist}
      isMobile={isMobile}
    >
      {(handle) => {
        handleRef.current = handle
        const { cruise, picked } = handle
        return (
        <>
      {/* 顶部信息栏 */}
      <div className="absolute top-0 left-0 right-0 z-[1000] flex items-center justify-between px-4 py-2 bg-slate-900/80 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="text-slate-400 hover:text-white text-sm px-2 py-1 rounded hover:bg-slate-700"
          >
            ← 退出
          </button>
          <span className="text-xs text-slate-400">
            {mode === 'national' ? '全国模式' : mode === 'provincial' ? '省级模式' : '城市模式'}
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              difficulty === 'easy'
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-rose-500/20 text-rose-300'
            }`}
          >
            {difficulty === 'easy' ? '点选' : '巡航'}
          </span>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <span className={`font-mono font-bold ${timeLeft <= 30 ? 'text-red-400' : 'text-cyan-400'}`}>
            ⏱ {formatTime(timeLeft)}
          </span>
          <span className={`font-mono font-bold ${creditsTextClass(hintCredits)}`}>
            ⚡ {hintCredits}/100
          </span>
          <span className="text-slate-400">步数: {steps}</span>
          {!cruise.cruiseZoomed && (
            <span className="text-slate-400">本次 <span className="text-cyan-400">{cruise.cruiseDistUI.toFixed(1)}</span> / 累积 <span className="text-cyan-400">{(totalDist + cruise.cruiseDistUI).toFixed(0)}</span> km</span>
          )}
        </div>
      </div>

      {/* 目标地名提示 */}
      {game.hint_text && (
        <div className="absolute top-[110px] left-1/2 -translate-x-1/2 z-[1105] bg-amber-900/85 backdrop-blur-sm text-amber-200 text-base px-5 py-2.5 rounded-lg max-w-md text-center shadow-lg border border-amber-400/20">
          🎯 目标：{game.hint_text}
        </div>
      )}

      {/* C 救济：当前所在省/市（PC/移动均顶部小字 pill，避免遮挡底部方向按钮） */}
      {locationHint && !showResult && (
        <div className="absolute top-[44px] left-1/2 -translate-x-1/2 z-[1110] bg-slate-800/85 backdrop-blur-sm text-slate-200 text-xs px-3 py-1 rounded-full shadow border border-slate-600/50 animate-[fadeIn_0.3s_ease-out]">
          📍 {locationHint.text}
        </div>
      )}

      {/* B 救济：快到了 toast（3 秒） */}
      {reliefMsg && (
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 z-[1170] bg-emerald-900/85 backdrop-blur-md text-emerald-50 text-base font-bold px-6 py-3 rounded-xl shadow-2xl border border-emerald-400/40 animate-[fadeIn_0.2s_ease-out]">
          {reliefMsg}
        </div>
      )}

      {/* 简单模式点击未命中提示 */}
      {missMsg && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[1150] bg-red-900/55 backdrop-blur-md text-red-50 text-lg font-medium px-8 py-5 rounded-md shadow-2xl border border-red-400/40 text-center max-w-[calc(100%-3rem)]">
          ❌ {missMsg}
        </div>
      )}

      {/* 开局目标封面图（3 秒大图 / 移动缩略图常驻，按难度分级模糊，命中/结算解除） */}
      <CoverImage
        src={game.target_cover}
        stage={coverStage}
        isMobile={isMobile}
        preview={coverPreview}
        onStageChange={setCoverStage}
        onPreviewToggle={() => setCoverPreview((v) => !v)}
        hintText={game.hint_text}
        variant="solo"
      />

      {/* 开局玩法引导 */}
      <GuideModal
        show={showGuide && !showResult}
        difficulty={difficulty}
        variant="solo"
        cruiseSpeeds={cruiseSpeeds}
        onDismiss={dismissGuide}
      />

      {/* 简单模式面板 */}
      <EasyModePanel
        picked={picked}
        submitting={submitting}
        showResult={showResult}
        onPickConfirm={handlePickConfirm}
        showPanel={difficulty === 'easy' && !showResult}
        hints={hints}
        isMobile={isMobile}
        onGiveUp={handleGiveUp}
        hintCredits={hintCredits}
        easyDirHint={easyDirHint}
        onHint={handleHint}
        hintCostRenderer={(level) =>
          level === 1
            ? `📍 目标省份 ${hintCostText(5, 3, isMobile)}`
            : `💡 方向 ${hintCostText(10, 5, isMobile)}`
        }
        showProvinceHint={game?.mode !== 'provincial'}
        provinceHintUsed={hints.some((h) => h.hint_level === 1)}
      />

      {/* 困难模式面板 */}
      <HardModePanel
        show={difficulty !== 'easy' && !showResult}
        cruise={cruise}
        totalDist={totalDist}
        jumpDistances={jumpDistances}
        moving={moving}
        distanceInput={distanceInput}
        onDistanceInputChange={setDistanceInput}
        onJump={handleJump}
        onJumpDistance={jumpDistance}
        hintCredits={hintCredits}
        hints={hints}
        isMobile={isMobile}
        onHint={handleHint}
        hintCostRenderer={(level) =>
          level === 1
            ? `📍 省份 ${hintCostText(5, 3, isMobile)}`
            : `🧭 方位 ${hintCostText(40, 20, isMobile)}`
        }
        showProvinceHint={game?.mode !== 'provincial'}
        provinceHintUsed={hints.some((h) => h.hint_level === 1)}
        onGiveUp={handleGiveUp}
      />

      {/* 结算面板：中间偏左，目标标记在中间偏右，互不遮挡 */}
      {showResult && result && (
        <GameResultPanel
          variant="solo"
          hit={result.hit}
          distanceKm={result.distance_km}
          score={result.score}
          durationSec={result.duration_sec}
          steps={result.steps}
          totalDistanceKm={result.total_distance_km}
          difficulty={difficulty}
          targetName={result.target_name}
          targetPoiId={result.target_poi_id}
          targetCover={result.target_cover}
          targetSummary={result.target_summary}
          contributor={contributor}
          onLeave={onBack}
          onNewGame={handleNewGame}
        />
      )}

      {/* 错误提示 */}
      {error && game && (
        <div className="absolute bottom-4 right-4 z-[1000] bg-red-900/80 text-red-200 text-sm px-4 py-2 rounded-lg">
          {error}
        </div>
      )}
        </>
        )
      }}
    </InteractiveMapBase>
  )
}
