import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import L from 'leaflet'
import { pkApi, getStoredUser } from '../api/pk'
import { audioManager } from '../utils/audio'
import { usePolling } from '../hooks/usePolling'
import { useHeartbeat } from '../hooks/useHeartbeat'
import { detectIsMobileEnv } from '../utils/hint'
import type { PKGameState, PKHintResponse, PKCheckViewResponse } from '../types/pk'
import type { TargetShape } from '../types'
import {
  CRUISE_SPEEDS_BY_MODE,
  JUMP_DISTANCES_BY_MODE,
} from '../game/base/constants'
import { InteractiveMapBase } from '../game/base/InteractiveMapBase'
import type { InteractiveMapHandle } from '../game/base/InteractiveMapBase'
import { pkApiAdapter } from '../game/adapters/pkApiAdapter'
import type { CheckViewResult } from '../game/base/types'
import { EasyModePanel } from '../game/easy/EasyModePanel'
import { HardModePanel } from '../game/hard/HardModePanel'
import { CoverImage } from '../game/shared/CoverImage'
import { GuideModal } from '../game/shared/GuideModal'
import { GameResultPanel } from '../game/shared/GameResultPanel'

interface Props {
  gameId: number
  roomId: number
  onLeave: () => void
  onNewGame: (gameId: number) => void
  // 开局目标封面图（PKStartResponse.target_cover，按难度分级模糊展示）
  startCover?: string | null
}

export default function PKGame({ gameId, roomId, onLeave, onNewGame, startCover }: Props) {
  // 设备识别（PC 弱化 / 移动强化）
  const isMobile = detectIsMobileEnv()
  // InteractiveMapBase 句柄（render prop 中赋值，回调中通过 ref 访问）
  const handleRef = useRef<InteractiveMapHandle | null>(null)
  const gameIdRef = useRef(gameId)
  const endedRef = useRef(false)
  const [contributor, setContributor] = useState<string | null>(null)
  // 开局目标封面图：big 大图 / thumb 移动缩略图常驻 / hidden 隐藏
  const [coverStage, setCoverStage] = useState<'big' | 'thumb' | 'hidden'>(startCover ? 'big' : 'hidden')
  const [coverPreview, setCoverPreview] = useState(false)
  const coverTimerRef = useRef<number | null>(null)

  const [state, setState] = useState<PKGameState | null>(null)
  const [error, setError] = useState('')
  const [distanceInput, setDistanceInput] = useState('50')
  const distance = useMemo(() => {
    const n = parseInt(distanceInput, 10)
    if (Number.isNaN(n) || n < 1) return 1
    return Math.min(2000, n)
  }, [distanceInput])
  const [hints, setHints] = useState<PKHintResponse[]>([])
  const [moving, setMoving] = useState(false)
  const [showResult, setShowResult] = useState(false)
  const [rematchRequested, setRematchRequested] = useState(false)
  // 简单模式点击未命中提示
  const [missMsg, setMissMsg] = useState('')
  // 开局玩法引导（按难度记忆"不再提示"）
  // 初始 false，等 state.difficulty 加载后检查 localStorage 决定是否显示，
  // 避免已 dismiss 的用户看到引导闪现
  const [showGuide, setShowGuide] = useState(false)
  useEffect(() => {
    if (!state?.difficulty) return
    try {
      if (localStorage.getItem(`map_guide_dismissed_${state.difficulty}`) !== '1') {
        setShowGuide(true)
      }
    } catch {
      setShowGuide(true)
    }
  }, [state?.difficulty])
  const dismissGuide = useCallback(() => {
    try { if (state?.difficulty) localStorage.setItem(`map_guide_dismissed_${state.difficulty}`, '1') } catch {}
    setShowGuide(false)
  }, [state?.difficulty])
  const [submitting, setSubmitting] = useState(false)
  // 对手已离开：倒计时自动返回大厅
  const [opponentLeftCountdown, setOpponentLeftCountdown] = useState(0)
  // 对手离开需连续 3 秒确认，避免轮询竞态导致闪烁
  const [opponentLeftConfirmed, setOpponentLeftConfirmed] = useState(false)
  // 放弃本局确认弹窗
  const [showGiveUpConfirm, setShowGiveUpConfirm] = useState(false)
  const [givingUp, setGivingUp] = useState(false)

  // 累积移动距离（km）：巡航 + 跳转本地累加
  const [totalDist, setTotalDist] = useState(0)
  // 按模式选择快捷距离（单局内模式固定）
  const jumpDistances = state ? (JUMP_DISTANCES_BY_MODE[state.mode] || JUMP_DISTANCES_BY_MODE.national) : JUMP_DISTANCES_BY_MODE.national

  const cruiseSpeeds = CRUISE_SPEEDS_BY_MODE[state?.mode || 'national'] || CRUISE_SPEEDS_BY_MODE.national

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

  // 对手离开需连续 6 秒确认，避免轮询竞态/短暂网络抖动导致闪烁
  useEffect(() => {
    if (state?.opponent_left) {
      const t = setTimeout(() => setOpponentLeftConfirmed(true), 6000)
      return () => clearTimeout(t)
    } else {
      setOpponentLeftConfirmed(false)
    }
  }, [state?.opponent_left])

  // 对手已离开：5 秒倒计时后自动返回大厅（需连续 6 秒确认后才触发）
  useEffect(() => {
    if (!showResult || !opponentLeftConfirmed || opponentLeftCountdown > 0) return
    setOpponentLeftCountdown(5)
    const timer = setInterval(() => {
      setOpponentLeftCountdown((n) => {
        if (n <= 1) {
          clearInterval(timer)
          onLeave()
          return 0
        }
        return n - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [showResult, opponentLeftConfirmed, onLeave])

  const me = getStoredUser()
  gameIdRef.current = gameId

  // 开局目标封面图：3 秒大图后 PC 消失 / 移动缩小为右上角缩略图常驻
  useEffect(() => {
    if (coverStage !== 'big' || !startCover) return
    if (coverTimerRef.current) clearTimeout(coverTimerRef.current)
    coverTimerRef.current = window.setTimeout(() => {
      setCoverStage(isMobile ? 'thumb' : 'hidden')
    }, 3000)
    return () => {
      if (coverTimerRef.current) { clearTimeout(coverTimerRef.current); coverTimerRef.current = null }
    }
  }, [coverStage, startCover, isMobile])

  // 初始获取游戏状态
  useEffect(() => {
    endedRef.current = false
    setShowResult(false)
    setRematchRequested(false)
    setHints([])
    setContributor(null)
    // 重置累积距离（巡航状态由 cruise.reset 在 InteractiveMapBase key 变化时处理）
    setTotalDist(0)
    pkApi
      .getGameState(gameId)
      .then(setState)
      .catch((e) => setError(e.message))
  }, [gameId])

  // 新一局：重置封面图状态（大图）
  useEffect(() => {
    setCoverStage(startCover ? 'big' : 'hidden')
    setCoverPreview(false)
    if (coverTimerRef.current) { clearTimeout(coverTimerRef.current); coverTimerRef.current = null }
  }, [gameId, startCover])

  // 在地图上标记目标点并居中，同时解锁缩放方便查看；按 shape 渲染真实范围
  const revealTarget = useCallback((lng: number, lat: number, shape?: TargetShape | null) => {
    const map = handleRef.current?.mapRef.current
    const targetMarkerRef = handleRef.current?.targetMarkerRef
    const targetShapeLayerRef = handleRef.current?.targetShapeLayerRef
    if (!map || !targetMarkerRef || !targetShapeLayerRef) return
    const icon = L.divIcon({
      className: '',
      html:
        '<div class="relative w-24 h-24">' +
        '<span class="absolute inset-0 rounded-full bg-amber-500/50 animate-ping"></span>' +
        '<span class="absolute inset-6 rounded-full bg-amber-500 border-2 border-white shadow-lg"></span>' +
        '<span class="absolute inset-0 flex items-center justify-center text-3xl">🎯</span>' +
        '</div>',
      iconSize: [96, 96],
      iconAnchor: [48, 48],
    })
    targetMarkerRef.current = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(map)

    // 前台不显示目标真实范围（圆/多边形），只保留中心点标记
    if (targetShapeLayerRef.current) {
      map.removeLayer(targetShapeLayerRef.current)
      targetShapeLayerRef.current = null
    }

    // 结算后解锁缩放，方便玩家看清目标位置
    map.setMinZoom(3)
    map.setMaxZoom(18)
    map.scrollWheelZoom.enable()
    map.touchZoom.enable()
    map.doubleClickZoom.enable()
    const zoomControlRef = handleRef.current?.zoomControlRef
    if (zoomControlRef && !zoomControlRef.current) {
      zoomControlRef.current = L.control.zoom({ position: 'bottomright' }).addTo(map)
    }
    // 地图中心往左偏，让目标点显示在画面右侧（结算面板在中间偏左，互不遮挡）
    const z = 16
    const targetPoint = map.project([lat, lng], z)
    const offset = window.innerWidth >= 768 ? 200 : 0
    const centerPoint = L.point(targetPoint.x - offset, targetPoint.y)
    map.flyTo(map.unproject(centerPoint, z), z, { duration: 1.2 })
  }, [])

  // 轮询游戏状态（1 秒，强制刷新以同步倒计时与对手动态）
  usePolling<PKGameState>(
    () => pkApi.getGameState(gameIdRef.current),
    (s) => {
      setState(s)

      // 对手先命中 / 超时 / 平局 → 揭示目标并结算
      if (s.is_finished && !endedRef.current) {
        endedRef.current = true
        setShowGuide(false)
        if (s.target) {
          revealTarget(s.target.lng, s.target.lat, s.target.shape)
          setContributor(s.target.contributor_nickname || null)
        }
        window.setTimeout(() => {
          setShowResult(true)
          if (s.winner === me?.nickname) audioManager.win()
          else if (s.win_reason === 'draw') audioManager.draw()
          else audioManager.lose()
        }, 1400)
      }

      // 再来一局：检测到新对局 → 切换
      if (s.rematch_game_id) {
        onNewGame(s.rematch_game_id)
      }
    },
    { interval: 1000, enabled: !!state }
  )

  // 心跳：结算面板也持续发送，5 秒间隔确保对方能及时检测到离开
  useHeartbeat(roomId, !!state, 5000)

  // 倒计时音效：最后 10 秒每秒响一声
  const lastCountdownRef = useRef(0)
  useEffect(() => {
    if (!state || state.is_finished) return
    const sec = state.remaining_seconds
    if (sec <= 10 && sec > 0 && sec !== lastCountdownRef.current) {
      lastCountdownRef.current = sec
      audioManager.countdown()
    }
  }, [state?.remaining_seconds])

  // 我命中：等飞行揭示后展示结算
  const handleWin = useCallback(
    (res: PKCheckViewResponse) => {
      if (endedRef.current) return
      endedRef.current = true
      setShowGuide(false)
      audioManager.hit()
      // 清除落点标记
      const h = handleRef.current
      if (h?.mapRef.current && h.pickMarkerRef.current) {
        h.mapRef.current.removeLayer(h.pickMarkerRef.current)
        h.pickMarkerRef.current = null
      }
      h?.setPicked(null)
      if (res.target_lng != null && res.target_lat != null) {
        revealTarget(res.target_lng, res.target_lat, res.target_shape)
      }
      if (res.contributor_nickname) setContributor(res.contributor_nickname)
      window.setTimeout(() => {
        setShowResult(true)
        audioManager.win()
      }, 1600)
    },
    [revealTarget]
  )

  // 视野判定统一回调：命中则胜利（PK 无 B 救济）
  const onCheckView = useCallback((res: CheckViewResult) => {
    if (endedRef.current) return
    if (res.hit) {
      handleWin(res as any)
    }
  }, [handleWin])

  // 距离跳转：沿当前/上次方向直接移动指定 km（走后端 move）
  const handleJump = useCallback(() => {
    const cruise = handleRef.current?.cruise
    if (!cruise) return
    if (cruise.cruiseActiveRef.current) cruise.stopCruise()
    const dir = cruise.cruiseDirRef.current || cruise.lastDirRef.current
    if (!dir) { cruise.showToast('请先选择方向'); return }
    if (!state || moving || endedRef.current) return
    cruise.lastDirRef.current = dir
    setMoving(true)
    pkApi
      .move(gameIdRef.current, dir, distance)
      .then((res) => {
        setTotalDist((prev) => prev + distance)
        handleRef.current?.mapRef.current?.panTo([res.view_lat, res.view_lng], { animate: true, duration: 0.8 })
      })
      .catch((e: any) => setError(e.message))
      .finally(() => setMoving(false))
  }, [state, moving, distance])

  // 快捷距离跳转：沿当前方向直接移动指定 km
  const jumpDistance = useCallback((km: number) => {
    const cruise = handleRef.current?.cruise
    if (!cruise) return
    if (cruise.cruiseActiveRef.current) cruise.stopCruise()
    const dir = cruise.cruiseDirRef.current || cruise.lastDirRef.current
    if (!dir) { cruise.showToast('请先选择方向'); return }
    if (!state || moving || endedRef.current) return
    cruise.lastDirRef.current = dir
    setMoving(true)
    pkApi
      .move(gameIdRef.current, dir, km)
      .then((res) => {
        setTotalDist((prev) => prev + km)
        handleRef.current?.mapRef.current?.panTo([res.view_lat, res.view_lng], { animate: true, duration: 0.8 })
      })
      .catch((e: any) => setError(e.message))
      .finally(() => setMoving(false))
  }, [state, moving])

  const handleHint = async (level: number) => {
    if (!state || endedRef.current) return
    try {
      const res = await pkApi.useHint(gameIdRef.current, level)
      setHints((prev) => [...prev, res])
      const map = handleRef.current?.mapRef.current
      const hintRectRef = handleRef.current?.hintRectRef
      if (res.bounds && map && hintRectRef) {
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
      setError(e.message)
    }
  }

  // 简单模式：确认落点，提交判定
  const handlePickConfirm = useCallback(() => {
    const id = gameIdRef.current
    const picked = handleRef.current?.picked
    if (!id || endedRef.current || !picked || submitting) return
    setSubmitting(true)
    pkApi
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

  const handleRematch = async () => {
    setRematchRequested(true)
    try {
      const res = await pkApi.rematch(roomId)
      if (res.both_ready && res.new_game_id) {
        onNewGame(res.new_game_id)
      }
    } catch (e: any) {
      setError(e.message)
      setRematchRequested(false)
    }
  }

  const handleGiveUp = useCallback(async () => {
    const id = gameIdRef.current
    if (!id || endedRef.current || givingUp) return
    setGivingUp(true)
    try {
      await pkApi.giveUp(id)
      // 放弃后对方直接胜利，等待轮询同步状态
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGivingUp(false)
      setShowGiveUpConfirm(false)
    }
  }, [givingUp])

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  // ===== 渲染 =====

  if (error && !state) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-900">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button onClick={onLeave} className="px-6 py-2 bg-slate-700 rounded-lg hover:bg-slate-600">
            返回大厅
          </button>
        </div>
      </div>
    )
  }

  if (!state) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-900">
        <div className="animate-pulse text-cyan-400 text-lg font-hud tracking-widest">正在进入战场...</div>
      </div>
    )
  }

  // 胜负判定
  const isFinished = state.is_finished
  const iWon = isFinished && state.winner === me?.nickname
  const isDraw = isFinished && state.win_reason === 'draw'

  return (
    <InteractiveMapBase
      key={gameId}
      startLng={state.my_view_lng}
      startLat={state.my_view_lat}
      mode={state.mode}
      difficulty={state.difficulty}
      gameIdRef={gameIdRef}
      endedRef={endedRef}
      apiAdapter={pkApiAdapter}
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
      {/* 顶部 VS 信息栏 */}
      <div className="absolute top-0 left-0 right-0 z-[1000]">
        <div className="flex items-stretch justify-between bg-slate-900/85 backdrop-blur-sm border-b border-slate-700/50">
          {/* 我方（青色） */}
          <div className="flex-1 px-4 py-2 border-r border-slate-700/30">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-400" />
              <span className="text-sm font-medium text-cyan-300 truncate max-w-[100px]">
                {me?.nickname || '我'}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-[11px] text-slate-400">
              <span>步数 {state.my_steps}</span>
              <span>{state.my_distance_km.toFixed(0)} km</span>
              {state.my_hit && <span className="text-green-400 font-bold">✓ 命中</span>}
            </div>
          </div>

          {/* 中间倒计时 */}
          <div className="px-5 py-2 flex flex-col items-center justify-center">
            <span
              className={`font-display text-2xl font-bold tabular-nums ${
                state.remaining_seconds <= 30 ? 'text-red-400 animate-pulse' : 'text-white'
              }`}
            >
              {formatTime(state.remaining_seconds)}
            </span>
            <span className="font-hud text-[10px] tracking-[0.3em] text-slate-500 uppercase">
              {state.mode === 'national' ? '全国' : state.mode === 'provincial' ? '省级' : '城市'}
              {state.difficulty === 'easy' ? ' · 点选' : ' · 巡航'}
            </span>
          </div>

          {/* 对手（玫红） */}
          <div className="flex-1 px-4 py-2 border-l border-slate-700/30 text-right">
            <div className="flex items-center gap-2 justify-end">
              <span className="text-sm font-medium text-rose-300 truncate max-w-[100px]">
                {state.opponent_nickname}
              </span>
              <span className="w-2 h-2 rounded-full bg-rose-400" />
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-[11px] text-slate-400 justify-end">
              {state.opponent_hit && <span className="text-green-400 font-bold">✓ 命中</span>}
              <span>步数 {state.opponent_steps}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 开局目标封面图（3 秒大图 / 移动缩略图常驻，命中后解除） */}
      <CoverImage
        src={startCover}
        stage={coverStage}
        isMobile={isMobile}
        preview={coverPreview}
        onStageChange={setCoverStage}
        onPreviewToggle={() => setCoverPreview((v) => !v)}
        hidden={showResult}
        variant="pk"
      />

      {/* 目标地名提示 */}
      {state.hint_text && !showResult && (
        <div className="absolute top-[110px] left-1/2 -translate-x-1/2 z-[1105] bg-amber-900/85 backdrop-blur-sm text-amber-200 text-base px-5 py-2.5 rounded-lg max-w-md text-center shadow-lg border border-amber-400/20">
          🎯 目标：{state.hint_text}
        </div>
      )}

      {/* 简单模式点击未命中提示 */}
      {missMsg && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[1150] bg-red-900/55 backdrop-blur-md text-red-50 text-lg font-medium px-8 py-5 rounded-md shadow-2xl border border-red-400/40 text-center max-w-[calc(100%-3rem)]">
          ❌ {missMsg}
        </div>
      )}

      {/* 开局玩法引导 */}
      <GuideModal
        show={showGuide && !showResult}
        difficulty={state.difficulty}
        variant="pk"
        cruiseSpeeds={cruiseSpeeds}
        onDismiss={dismissGuide}
      />

      {/* 简单模式面板（PK 无积分/方向提示，仅显示提示列表 + 放弃） */}
      <EasyModePanel
        picked={picked}
        submitting={submitting}
        showResult={showResult}
        onPickConfirm={handlePickConfirm}
        showPanel={state.difficulty === 'easy' && !showResult}
        hints={hints}
        isMobile={isMobile}
        onGiveUp={() => setShowGiveUpConfirm(true)}
        giveUpDisabled={isFinished}
      />

      {/* 困难模式面板（PK 轻量放弃按钮，无提示面板） */}
      <HardModePanel
        show={state.difficulty !== 'easy' && !showResult}
        cruise={cruise}
        totalDist={totalDist}
        jumpDistances={jumpDistances}
        moving={moving}
        distanceInput={distanceInput}
        onDistanceInputChange={setDistanceInput}
        onJump={handleJump}
        onJumpDistance={jumpDistance}
        hints={hints}
        isMobile={isMobile}
        onGiveUp={() => setShowGiveUpConfirm(true)}
        giveUpDisabled={isFinished}
        pkStyleGiveUp
      />

      {/* 结算面板：中间偏左，目标标记在中间偏右，互不遮挡 */}
      {showResult && (
        <GameResultPanel
          variant="pk"
          isDraw={isDraw}
          iWon={iWon}
          winReason={state.win_reason}
          myScore={state.my_score}
          opponentScore={state.opponent_score}
          opponentNickname={state.opponent_nickname}
          myToTargetKm={state.my_to_target_km}
          opponentToTargetKm={state.opponent_to_target_km}
          myHit={state.my_hit}
          opponentHit={state.opponent_hit}
          difficulty={state.difficulty}
          targetName={state.target?.name}
          targetPoiId={state.target?.poi_id}
          targetCover={state.target?.cover}
          targetSummary={state.target?.summary}
          contributor={contributor}
          opponentLeftConfirmed={opponentLeftConfirmed}
          opponentLeftCountdown={opponentLeftCountdown}
          rematchRequested={rematchRequested}
          opponentRematch={state.opponent_rematch}
          onLeave={onLeave}
          onRematch={handleRematch}
        />
      )}

      {/* 错误提示 */}
      {error && state && (
        <div className="absolute bottom-4 right-4 z-[1000] bg-red-900/80 text-red-200 text-sm px-4 py-2 rounded-lg">
          {error}
        </div>
      )}

      {/* 放弃确认弹窗 */}
      {showGiveUpConfirm && (
        <div className="absolute inset-0 z-[3000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6 w-72 text-center">
            <div className="text-3xl mb-3">🏳️</div>
            <div className="text-white font-bold mb-2">确认放弃本局？</div>
            <div className="text-xs text-slate-400 mb-5">放弃后对方将直接判定胜利</div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowGiveUpConfirm(false)}
                disabled={givingUp}
                className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-sm font-medium text-slate-200 transition-colors"
              >
                继续游戏
              </button>
              <button
                onClick={handleGiveUp}
                disabled={givingUp}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 rounded-xl text-sm font-bold text-white transition-colors disabled:opacity-60"
              >
                {givingUp ? '提交中…' : '确认放弃'}
              </button>
            </div>
          </div>
        </div>
      )}
        </>
        )
      }}
    </InteractiveMapBase>
  )
}
