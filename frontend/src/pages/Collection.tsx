/**
 * Collection — 专题模式游戏流程
 *
 * 串联多个单局（SingleGame），管理进度、用时、过渡动画、结算。
 * 流程：开始专题 → 逐点游戏 → 单点结算 → 过渡动画 → ... → 专题结算
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import type { ReactNode } from 'react'
import { SingleGame } from '../game/SingleGame'
import type { GameEndResult } from '../game/useSingleGame'
import { collectionApi, isLoggedIn, getStoredUser } from '../api/collection'
import type {
  StartCollectionResponse,
  PointEndResponse,
  FinishCollectionResponse,
} from '../api/collection'
import AuthModal from '../components/AuthModal'
import type { StartResponse } from '../types'

type Phase = 'loading' | 'playing' | 'point_settlement' | 'transitioning' | 'finished' | 'error'

interface Props {
  code: string
  difficulty: string
  onBack: () => void
  onStartDifficulty?: (difficulty: string) => void
}

export default function Collection({ code, difficulty, onBack, onStartDifficulty }: Props) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState('')
  const [collectionData, setCollectionData] = useState<StartCollectionResponse | null>(null)
  const [currentPoint, setCurrentPoint] = useState(0)
  const [pointTimes, setPointTimes] = useState<number[]>([])
  const [pointNames, setPointNames] = useState<string[]>([])
  const [gameKey, setGameKey] = useState(0)
  const [pointEndData, setPointEndData] = useState<PointEndResponse | null>(null)
  const [finishData, setFinishData] = useState<FinishCollectionResponse | null>(null)
  const [earnedDifficulties, setEarnedDifficulties] = useState<Set<string>>(new Set())
  const [lastResult, setLastResult] = useState<GameEndResult | null>(null)
  const [showAuth, setShowAuth] = useState(false)
  const [authTick, setAuthTick] = useState(0)
  const [transitionProgress, setTransitionProgress] = useState(0)

  const pointStartRef = useRef<number>(0)
  const transitionTimerRef = useRef<number | null>(null)
  const progressTimerRef = useRef<number | null>(null)
  // 保存上一局结束时的地图 zoom，用于传递到下一局保持同等比例
  const lastZoomRef = useRef<number | undefined>(undefined)
  const autoAdvanceTimerRef = useRef<number | null>(null)

  const loggedIn = isLoggedIn()
  const currentUser = getStoredUser()

  // 初始化专题
  useEffect(() => {
    let cancelled = false
    setPhase('loading')
    setError('')
    collectionApi
      .start(code, difficulty, 'solo')
      .then((res) => {
        if (cancelled) return
        setCollectionData(res.data)
        setCurrentPoint(0)
        setPointTimes([])
        setPointNames([])
        setGameKey(0)
        setPointEndData(null)
        setFinishData(null)
        setLastResult(null)
        pointStartRef.current = Date.now()
        setPhase('playing')
      })
      .catch((e) => {
        if (cancelled) return
        setError(e.message || '启动专题失败')
        setPhase('error')
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, difficulty])

  // startFn：供 SingleGame 调用初始化单局
  // 第 0 点用 collectionData，后续点用 pointEndData
  const startFn = useCallback(
    (_startLng?: number, _startLat?: number): Promise<StartResponse> => {
      if (currentPoint === 0 && collectionData) {
        return Promise.resolve(adaptStartResponse(collectionData))
      }
      if (pointEndData && pointEndData.next_game_id) {
        return Promise.resolve(adaptFromPointEnd(collectionData!, pointEndData))
      }
      return Promise.reject(new Error('无下一局数据'))
    },
    [currentPoint, collectionData, pointEndData]
  )

  // 单局结束回调
  const handleGameEnd = useCallback(
    (result: GameEndResult) => {
      // 放弃/超时：进入失败结算页，专题进度不保留、不发勋章
      if (!result.hit) {
        const failedPointTime = Math.max(1, Math.round((Date.now() - pointStartRef.current) / 1000))
        setPointTimes((prev) => [...prev, failedPointTime])
        setPointNames((prev) => [...prev, result.targetName])
        setLastResult(result)
        setFinishData({
          collection_id: collectionData?.collection_id ?? 0,
          collection_name: collectionData?.collection_name ?? '',
          difficulty,
          game_type: 'solo',
          total_time_sec: pointTimes.reduce((sum, time) => sum + time, 0) + failedPointTime,
          point_times: [...pointTimes, failedPointTime],
          medal_awarded: false,
          is_new_best: false,
          medal_name: null,
          medal_icon_url: null,
        })
        setEarnedDifficulties(new Set())
        setPhase('finished')
        return
      }

      const pointTime = Math.max(1, Math.round((Date.now() - pointStartRef.current) / 1000))
      const newPointTimes = [...pointTimes, pointTime]
      const newPointNames = [...pointNames, result.targetName]
      setPointTimes(newPointTimes)
      setPointNames(newPointNames)
      setLastResult(result)
      // 保存当前地图 zoom，点选模式下新局继承同等比例
      if (result.zoom != null) {
        lastZoomRef.current = result.zoom
      }

      const collectionId = collectionData?.collection_id
      if (!collectionId) return

      collectionApi
        .pointEnd(collectionId, currentPoint, pointTime, result.hit, difficulty, 'solo')
        .then((res) => {
          const pe = res.data
          setPointEndData(pe)
          if (pe.has_next) {
            // 点选/巡航模式：跳过结算页，直接进入下一局
            setCurrentPoint((prev) => prev + 1)
            setGameKey((prev) => prev + 1)
            setLastResult(null)
            pointStartRef.current = Date.now()
            setPhase('playing')
          } else {
            // 最后一点 → 完成专题
            const totalTime = newPointTimes.reduce((a, b) => a + b, 0)
            collectionApi
              .finish(collectionId, difficulty, 'solo', totalTime, newPointTimes, result.hit)
              .then(async (fr) => {
                setFinishData(fr.data)
                const earned = new Set<string>()
                if (fr.data.medal_awarded) earned.add(difficulty)
                if (isLoggedIn()) {
                  try {
                    const medals = await collectionApi.medalWall(undefined, undefined)
                    for (const group of medals.data) {
                      for (const medal of group.medals) {
                        if (medal.collection_id === collectionId && medal.earned) {
                          earned.add(medal.difficulty)
                        }
                      }
                    }
                  } catch {
                    // 当前勋章状态已由 finish 响应补充
                  }
                }
                setEarnedDifficulties(earned)
                setPhase('finished')
              })
              .catch((e) => {
                setError(e.message || '完成专题失败')
                setPhase('error')
              })
          }
        })
        .catch((e) => {
          setError(e.message || '记录进度失败')
          setPhase('error')
        })
    },
    [pointTimes, pointNames, currentPoint, collectionData, difficulty]
  )

  // 前往下一点：触发过渡动画（easy 点选模式直接进入，不做过渡）
  const handleNextPoint = useCallback(() => {
    if (!pointEndData?.has_next) return

    const doStart = () => {
      if (autoAdvanceTimerRef.current) { clearTimeout(autoAdvanceTimerRef.current); autoAdvanceTimerRef.current = null }
      if (progressTimerRef.current) clearInterval(progressTimerRef.current)
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current)
      setCurrentPoint((prev) => prev + 1)
      setGameKey((prev) => prev + 1)
      setLastResult(null)
      pointStartRef.current = Date.now()
      setPhase('playing')
    }

    if (difficulty === 'easy') {
      doStart()
      return
    }

    setPhase('transitioning')
    setTransitionProgress(0)

    // 进度条动画
    const startTime = Date.now()
    const duration = 1000
    progressTimerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startTime
      const pct = Math.min(100, (elapsed / duration) * 100)
      setTransitionProgress(pct)
      if (pct >= 100 && progressTimerRef.current) clearInterval(progressTimerRef.current)
    }, 50)

    // 过渡结束 → 进入下一点（不要清空 pointEndData，startFn 需要它生成下一点开局数据）
    transitionTimerRef.current = window.setTimeout(doStart, duration)
  }, [pointEndData, difficulty])

  // 跳过动画
  const handleSkipTransition = useCallback(() => {
    if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current)
    setCurrentPoint((prev) => prev + 1)
    setGameKey((prev) => prev + 1)
    setLastResult(null)
    pointStartRef.current = Date.now()
    setTransitionProgress(100)
    setPhase('playing')
  }, [])

  // 再来一局：从头开始
  const handleRestart = useCallback(() => {
    setPhase('loading')
    setError('')
    setCollectionData(null)
    setCurrentPoint(0)
    setPointTimes([])
    setPointNames([])
    setGameKey(0)
    setPointEndData(null)
    setFinishData(null)
    setLastResult(null)
    // 重新挂载会触发 useEffect 初始化
    setAuthTick((t) => t + 1)
  }, [])

  useEffect(() => {
    if (authTick > 0) {
      collectionApi
        .start(code, difficulty, 'solo')
        .then((res) => {
          setCollectionData(res.data)
          pointStartRef.current = Date.now()
          setPhase('playing')
        })
        .catch((e) => {
          setError(e.message || '启动专题失败')
          setPhase('error')
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authTick])

  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current)
      if (progressTimerRef.current) clearInterval(progressTimerRef.current)
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current)
    }
  }, [])

  const collectionName = collectionData?.collection_name || ''
  const pointCount = collectionData?.point_count || 0
  const title = `${collectionName} ${currentPoint + 1}/${pointCount}`

  // ===== 渲染 =====

  let content: ReactNode
  if (phase === 'error') {
    content = (
      <div className="h-full flex items-center justify-center bg-slate-900">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button onClick={onBack} className="px-6 py-2 bg-slate-700 rounded-lg hover:bg-slate-600">
            返回专题列表
          </button>
        </div>
      </div>
    )
  } else if (phase === 'loading' && !collectionData) {
    content = (
      <div className="h-full flex items-center justify-center bg-slate-900">
        <div className="animate-pulse text-cyan-400 text-lg">正在启动专题...</div>
      </div>
    )
  } else if (phase === 'transitioning') {
    content = (
      <div className="h-full relative bg-slate-900">
        {collectionData && (
          <SingleGame
            key={`transition-${gameKey}`}
            startFn={startFn}
            difficulty={difficulty}
            mode={collectionData.mode}
            onGameEnd={() => {}}
            onBack={onBack}
            gameKey={`transition-${gameKey}`}
            variant="collection"
            title={title}
          />
        )}
        <div className="absolute inset-0 z-[2000] bg-slate-900/70 backdrop-blur-sm flex flex-col items-center justify-center">
          <div className="text-cyan-300 text-2xl font-bold mb-4 animate-pulse">
            ✈️ 前往第 {currentPoint + 2} 个地点
          </div>
          <div className="w-64 h-2 bg-slate-700 rounded-full overflow-hidden">
            <div className="h-full bg-cyan-400 transition-all duration-75" style={{ width: `${transitionProgress}%` }} />
          </div>
          <button onClick={handleSkipTransition} className="mt-6 text-xs text-slate-400 hover:text-cyan-300 px-4 py-1.5 rounded-lg border border-slate-600 hover:border-cyan-500">
            跳过动画
          </button>
          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2">
            {Array.from({ length: pointCount }).map((_, i) => (
              <div key={i} className={`w-8 h-1 rounded-full transition-colors ${i <= currentPoint ? 'bg-cyan-400' : 'bg-slate-600'}`} />
            ))}
          </div>
        </div>
      </div>
    )
  } else if (phase === 'point_settlement' && lastResult) {
    content = (
      <div className="h-full relative bg-slate-900">
        {collectionData && (
          <SingleGame
            key={`settle-${gameKey}`}
            startFn={startFn}
            difficulty={difficulty}
            mode={collectionData.mode}
            onGameEnd={() => {}}
            onBack={onBack}
            gameKey={`settle-${gameKey}`}
            variant="collection"
            title={title}
            initZoom={lastZoomRef.current}
          />
        )}
        <div className="absolute inset-0 z-[2000] bg-slate-900/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="px-5 pt-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-cyan-300 font-bold">{currentPoint + 1}/{pointCount} 已收集</span>
                <span className="text-xs text-slate-400">{collectionName}</span>
              </div>
              <div className="flex gap-1">
                {Array.from({ length: pointCount }).map((_, i) => (
                  <div key={i} className={`flex-1 h-2 rounded-full transition-colors ${i <= currentPoint ? 'bg-cyan-400' : 'bg-slate-600'}`} />
                ))}
              </div>
            </div>
            <div className="p-5 text-center">
              <div className="text-4xl mb-2">{lastResult.hit ? '✅' : '📍'}</div>
              <h3 className="text-lg font-bold text-cyan-300 mb-1">{lastResult.targetName}</h3>
              <p className="text-xs text-slate-400 mb-3">
                用时 {formatTime(pointTimes[currentPoint] || 0)}
                {!lastResult.hit && ' · 未命中'}
              </p>
              {lastResult.targetSummary && (
                <div className="bg-slate-900/60 rounded-lg p-3 mb-4 text-left">
                  <p className="text-xs text-slate-300 leading-relaxed">💡 {lastResult.targetSummary}</p>
                </div>
              )}
              {lastResult.targetPoiId != null && (
                <button
                  onClick={() => lastResult.targetPoiId != null && window.dispatchEvent(new CustomEvent('open-correction', { detail: { poiId: lastResult.targetPoiId } }))}
                  className="w-full mb-2 py-1.5 text-xs text-slate-500 hover:text-slate-300 rounded-lg transition-colors"
                >
                  ✎ 地点信息有误？纠正此地点
                </button>
              )}
              <button onClick={handleNextPoint} className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold text-sm transition-colors">
                前往下一点 →
              </button>
              <button onClick={onBack} className="w-full mt-2 py-2 text-slate-400 hover:text-white text-xs">
                放弃专题
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  } else if (phase === 'finished' && finishData) {
    content = <CollectionSettlement
      finishData={finishData}
      pointTimes={pointTimes}
      pointNames={pointNames}
      difficulty={difficulty}
      loggedIn={loggedIn}
      currentUser={currentUser}
      onAuth={() => setShowAuth(true)}
      onBack={onBack}
      onRestart={handleRestart}
      earnedDifficulties={earnedDifficulties}
      onStartDifficulty={onStartDifficulty}
      failed={!lastResult?.hit}
    />
  } else if (phase === 'playing' && collectionData) {
    content = (
      <div className="relative h-full">
        <SingleGame
          key={gameKey}
          startFn={startFn}
          difficulty={difficulty}
          mode={collectionData.mode}
          onGameEnd={handleGameEnd}
          onBack={onBack}
          gameKey={gameKey}
          variant="collection"
          title={title}
          initZoom={lastZoomRef.current}
        />
        {/* 底部进度条：居中窄条（25%-75%）沉底，z 低不挡方向/确认按钮 */}
        <div className="absolute bottom-0 left-1/4 right-1/4 z-[900] bg-slate-900/80 backdrop-blur-sm px-4 py-1.5 rounded-t-xl">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-400 rounded-full transition-all duration-500"
                style={{ width: `${pointCount > 0 ? (currentPoint / pointCount) * 100 : 0}%` }}
              />
            </div>
            <span className="text-xs text-slate-300 whitespace-nowrap">
              {currentPoint}/{pointCount} 已收集
            </span>
          </div>
        </div>
      </div>
    )
  } else {
    content = (
      <div className="h-full flex items-center justify-center bg-slate-900">
        <div className="text-slate-400">加载中...</div>
      </div>
    )
  }

  return (
    <>
      {content}
      {showAuth && (
        <AuthModal
          onClose={() => setShowAuth(false)}
          onSuccess={() => setShowAuth(false)}
        />
      )}
    </>
  )
}

// ===== 专题结算子组件 =====

interface SettlementProps {
  finishData: FinishCollectionResponse
  pointTimes: number[]
  pointNames: string[]
  difficulty: string
  loggedIn: boolean
  currentUser: { nickname: string; total_medals: number } | null
  onAuth: () => void
  onBack: () => void
  onRestart: () => void
  earnedDifficulties: Set<string>
  onStartDifficulty?: (difficulty: string) => void
  failed: boolean
}

function CollectionSettlement({
  finishData,
  pointTimes,
  pointNames,
  difficulty,
  loggedIn,
  currentUser,
  onAuth,
  onBack,
  onRestart,
  earnedDifficulties,
  onStartDifficulty,
  failed,
}: SettlementProps) {
  const totalTime = finishData.total_time_sec
  const maxTime = Math.max(...pointTimes, 1)
  const minTimeIdx = pointTimes.indexOf(Math.min(...pointTimes))
  const maxTimeIdx = pointTimes.indexOf(maxTime)

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-2xl mx-auto p-4 pt-8">
        {/* 标题 */}
        <div className="text-center mb-6">
          <div className="text-5xl mb-2">{failed ? '❌' : difficulty === 'hard' ? '🏅' : '🎉'}</div>
          <h2 className="text-xl font-bold text-cyan-300">{finishData.collection_name}</h2>
          <p className="text-sm text-slate-400 mt-1">
            {failed ? '专题挑战失败' : `${difficulty === 'hard' ? '巡航模式' : '点选模式'} · 专题完成`}
          </p>
          {failed && <p className="text-sm text-rose-300 mt-2">已放弃，本次收集进度不保留</p>}
        </div>

        {/* 总用时 */}
        <div className="bg-slate-800/80 rounded-2xl border border-slate-700 p-5 mb-4 text-center">
          <div className="text-xs text-slate-400 mb-1">总用时</div>
          <div className="text-3xl font-bold text-cyan-300 font-mono">{formatTime(totalTime)}</div>
        </div>

        {/* D1 柱状图 */}
        <div className="bg-slate-800/80 rounded-2xl border border-slate-700 p-5 mb-4">
          <h3 className="text-sm font-bold text-slate-300 mb-4">各点用时</h3>
          <div className="space-y-2">
            {pointTimes.map((t, i) => {
              const pct = (t / maxTime) * 100
              const isMin = i === minTimeIdx && pointTimes.length > 1
              const isMax = i === maxTimeIdx && pointTimes.length > 1
              const color = isMin ? 'bg-emerald-400' : isMax ? 'bg-rose-400' : 'bg-cyan-400'
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 w-20 truncate text-right">
                    {pointNames[i] || `第${i + 1}点`}
                  </span>
                  <div className="flex-1 h-6 bg-slate-900/60 rounded overflow-hidden">
                    <div
                      className={`h-full ${color} flex items-center justify-end px-2 transition-all duration-500`}
                      style={{ width: `${Math.max(8, pct)}%` }}
                    >
                      <span className="text-[10px] text-slate-900 font-bold">{formatTime(t)}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 勋章区域 — 点选/巡航统一处理 */}
        {failed ? (
          <div className="bg-rose-900/30 rounded-2xl border border-rose-500/40 p-5 mb-4 text-center">
            <div className="text-4xl mb-2">📍</div>
            <p className="text-rose-300 font-bold text-lg">本次挑战未完成</p>
            <p className="text-sm text-slate-400 mt-2">专题进度不会保留，也不会获得勋章</p>
          </div>
        ) : finishData.medal_awarded ? (
          <div className="bg-gradient-to-r from-amber-900/40 to-amber-800/40 rounded-2xl border border-amber-500/40 p-5 mb-4 text-center medal-awarded">
            <div className="text-4xl mb-2 medal-icon">🎖️</div>
            <p className="text-amber-300 font-bold text-lg">{finishData.collection_name}·{finishData.difficulty === 'easy' ? '点选' : '巡航'}</p>
            {finishData.is_new_best && (
              <p className="text-xs text-amber-200 mt-1">🏆 新纪录！</p>
            )}
          </div>
        ) : !loggedIn ? (
          <div className="bg-amber-900/30 rounded-2xl border border-amber-500/40 p-5 mb-4 text-center">
            <div className="text-4xl mb-2">🔒</div>
            <p className="text-sm text-amber-200 mb-3">登录后可保存成绩，赢得勋章</p>
            <button
              onClick={onAuth}
              className="px-6 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-bold"
            >
              登录保存成绩
            </button>
          </div>
        ) : (
          <div className="bg-slate-800/80 rounded-2xl border border-slate-700 p-5 mb-4 text-center">
            <p className="text-sm text-slate-300">本次未刷新最佳成绩，继续努力！</p>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-3">
          <button
            onClick={onBack}
            className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold text-sm transition-colors"
          >
            返回专题列表
          </button>
          {failed ? (
            <button
              onClick={onRestart}
              className="flex-1 py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold text-sm transition-colors"
            >
              重新挑战
            </button>
          ) : earnedDifficulties.has('easy') && earnedDifficulties.has('hard') ? (
            <button
              onClick={onBack}
              className="flex-1 py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold text-sm transition-colors"
            >
              开启下个专题
            </button>
          ) : (
            <button
              onClick={() => onStartDifficulty?.(earnedDifficulties.has('easy') ? 'hard' : 'easy')}
              className="flex-1 py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold text-sm transition-colors"
            >
              开启{earnedDifficulties.has('easy') ? '巡航' : '点选'}挑战
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ===== 工具函数 =====

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function adaptStartResponse(data: StartCollectionResponse): StartResponse {
  return {
    game_id: data.game_id,
    mode: data.mode,
    difficulty: data.difficulty,
    start_lng: data.start_lng,
    start_lat: data.start_lat,
    time_limit: data.time_limit,
    tolerance_km: data.tolerance_km,
    hint_text: data.target_name ? `寻找：${data.target_name}` : null,
    target_cover: data.target_cover,
    hint_credits: 100,
    device: data.device,
  }
}

function adaptFromPointEnd(
  coll: StartCollectionResponse,
  pe: PointEndResponse
): StartResponse {
  return {
    game_id: pe.next_game_id ?? coll.game_id,
    mode: pe.next_mode ?? coll.mode,
    difficulty: coll.difficulty,
    start_lng: pe.next_start_lng ?? coll.start_lng,
    start_lat: pe.next_start_lat ?? coll.start_lat,
    time_limit: pe.next_time_limit ?? coll.time_limit,
    tolerance_km: pe.next_tolerance_km ?? coll.tolerance_km,
    hint_text: pe.next_target_name ? `寻找：${pe.next_target_name}` : null,
    target_cover: pe.next_target_cover ?? null,
    hint_credits: 100,
    device: coll.device,
  }
}
