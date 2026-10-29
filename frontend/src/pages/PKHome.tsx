import { useState, useEffect } from 'react'
import { pkApi, isLoggedIn, getStoredUser, setToken, setStoredUser } from '../api/pk'
import { api } from '../api'

interface GameConfig {
  mode: string
  regionCode?: string
  difficulty: string
  category?: string
}

interface InviteInfo {
  code: string
  error?: string
}

interface Props {
  pkConfig: GameConfig
  onBack: () => void
  onEnterRoom: (roomId: number, roomCode: string, isHost: boolean) => void
  invite?: InviteInfo | null
  onConsumeInvite?: () => void
}

const MODE_LABELS: Record<string, string> = {
  national: '全国漫游',
  provincial: '省份挑战',
  theme: '主题挑战',
}

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: '点选',
  hard: '巡航',
}

export default function PKHome({ pkConfig, onBack, onEnterRoom, invite, onConsumeInvite }: Props) {
  const [nickname, setNickname] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)
  const [loginError, setLoginError] = useState('')

  const [tab, setTab] = useState<'create' | 'join'>(invite?.code ? 'join' : 'create')
  const [joinCode, setJoinCode] = useState(invite?.code || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(invite?.error || '')
  const [recommended, setRecommended] = useState<string[]>([])

  const user = getStoredUser()
  const loggedIn = isLoggedIn()

  useEffect(() => {
    if (loggedIn) {
      pkApi.cleanup().catch(() => {})
    }
  }, [loggedIn])

  const fetchRecommended = () => {
    pkApi.recommendNicknames(8).then((res) => setRecommended(res.nicknames)).catch(() => {})
  }

  useEffect(() => {
    if (!loggedIn) fetchRecommended()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn])

  const handleLogin = async () => {
    const name = nickname.trim()
    if (!name) return
    setLoggingIn(true)
    setLoginError('')
    try {
      const res = await pkApi.login(name)
      setToken(res.token)
      setStoredUser(res.user)
      pkApi.cleanup().catch(() => {})

      const code = invite?.code
      if (code) {
        onConsumeInvite?.()
        try {
          const joinRes = await pkApi.joinRoom(code)
          onEnterRoom(joinRes.room_id, code, false)
          return
        } catch (e: any) {
          setTab('join')
          setJoinCode(code)
          setError(e.message || '加入房间失败')
        }
      }
    } catch (e: any) {
      setLoginError(e.message)
    } finally {
      setLoggingIn(false)
    }
  }

  const handleCreate = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await pkApi.createRoom(
        pkConfig.mode,
        pkConfig.regionCode,
        pkConfig.difficulty,
        pkConfig.category
      )
      onEnterRoom(res.room_id, res.room_code, true)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const handleJoin = async () => {
    const code = joinCode.trim().toUpperCase()
    if (code.length !== 4) return
    setBusy(true)
    setError('')
    try {
      const res = await pkApi.joinRoom(code)
      onEnterRoom(res.room_id, code, false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const [regionName, setRegionName] = useState<string | null>(null)
  const [themeName, setThemeName] = useState<string | null>(null)

  useEffect(() => {
    if (pkConfig.mode === 'provincial' && pkConfig.regionCode) {
      api.getRegions(1).then((regions) => {
        const r = regions.find((r) => r.code === pkConfig.regionCode)
        if (r) setRegionName(r.name)
      }).catch(() => {})
    }
    if (pkConfig.mode === 'national' && pkConfig.category) {
      api.getThemes().then((themes) => {
        const t = themes.find((t) => t.code === pkConfig.category)
        if (t) setThemeName(t.name)
      }).catch(() => {})
    }
  }, [pkConfig.mode, pkConfig.regionCode, pkConfig.category])

  // 主题模式在 Home 中以 mode='national' + category 传入，这里统一识别
  const isThemeMode = pkConfig.mode === 'national' && !!pkConfig.category
  const modeLabel = isThemeMode ? '主题挑战' : (MODE_LABELS[pkConfig.mode] || pkConfig.mode)
  const diffLabel = DIFFICULTY_LABELS[pkConfig.difficulty] || pkConfig.difficulty
  const detailLabel =
    pkConfig.mode === 'provincial' ? regionName :
    isThemeMode ? themeName :
    null

  // ===== 未登录：昵称登录 =====
  if (!loggedIn) {
    return (
      <div className="pk-bg h-full flex flex-col items-center justify-center p-4 relative overflow-hidden">
        <div className="relative z-10 w-full max-w-sm">
          <button
            onClick={onBack}
            className="mb-6 text-slate-500 hover:text-slate-300 text-sm transition-colors flex items-center gap-1"
          >
            ← 返回首页
          </button>

          <div className="text-center mb-8">
            <div className="font-display text-5xl font-black tracking-widest pk-vs-text mb-1">
              PK
            </div>
            <div className="font-hud text-sm tracking-[0.4em] text-slate-400 uppercase">
              对战竞技场
            </div>
          </div>

          <div className="pk-panel p-6">
            <label className="block font-hud text-xs tracking-widest text-slate-400 uppercase mb-2">
              输入昵称进入战场
            </label>
            <input
              type="text"
              maxLength={20}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="你的昵称"
              className="w-full bg-slate-900/70 border border-slate-600 focus:border-cyan-400 rounded-lg px-4 py-3 text-white placeholder-slate-600 focus:outline-none transition-colors"
            />
            {loginError && <p className="text-red-400 text-xs mt-2">{loginError}</p>}
            {invite?.code && (
              <p className="text-cyan-300 text-xs mt-3 text-center">
                收到邀请：登录后将自动加入房间 <span className="font-bold">{invite.code}</span>
              </p>
            )}

            {recommended.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-hud text-xs tracking-widest text-slate-500 uppercase">
                    或选一个昵称
                  </span>
                  <button
                    onClick={fetchRecommended}
                    className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                  >
                    换一批 ↻
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {recommended.map((name) => (
                    <button
                      key={name}
                      onClick={() => setNickname(name)}
                      className={`px-2.5 py-1 text-xs rounded-full border transition-colors whitespace-nowrap ${
                        nickname === name
                          ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300'
                          : 'border-slate-600 bg-slate-800/60 text-slate-300 hover:border-cyan-400/60 hover:text-cyan-200'
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={handleLogin}
              disabled={!nickname.trim() || loggingIn}
              className="w-full mt-4 py-3 rounded-lg font-bold text-white transition-all pk-btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loggingIn ? '进入中...' : '进入对战大厅'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ===== 已登录：对战大厅 =====
  return (
    <div className="pk-bg h-full flex flex-col items-center p-4 relative overflow-hidden">
      <div className="relative z-10 w-full max-w-md flex flex-col h-full py-6">
        {/* 顶栏 */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={onBack}
            className="text-slate-500 hover:text-slate-300 text-sm transition-colors"
          >
            ← 返回重新选择
          </button>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="font-hud text-sm text-slate-300">{user?.nickname}</span>
          </div>
        </div>

        {/* 标题 */}
        <div className="text-center mb-6">
          <h1 className="font-display text-4xl font-black tracking-widest pk-vs-text">
            PK ARENA
          </h1>
          <p className="text-slate-400 text-sm mt-2">
            与好友竞速，看谁先在卫星地图上找到目标
          </p>
        </div>

        {/* 当前模式信息 */}
        <div className="pk-panel p-5 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-500 mb-1">当前模式</div>
              <div className="text-lg font-bold text-cyan-300">{modeLabel}</div>
              {detailLabel && (
                <div className="text-sm text-amber-300 mt-1">{detailLabel}</div>
              )}
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500 mb-1">难度</div>
              <div className={`text-lg font-bold ${pkConfig.difficulty === 'easy' ? 'text-emerald-300' : 'text-rose-300'}`}>
                {diffLabel}
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-3 text-center">
            模式不合适？返回首页重新选择
          </p>
        </div>

        {/* 创建 / 加入 切换 */}
        <div className="grid grid-cols-2 gap-2 mb-6">
          <button
            onClick={() => { setTab('create'); setError('') }}
            className={`py-2.5 rounded-lg font-hud font-bold tracking-widest text-sm transition-all ${
              tab === 'create'
                ? 'bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-400/50'
                : 'bg-slate-800/60 text-slate-500 hover:text-slate-300'
            }`}
          >
            创建房间
          </button>
          <button
            onClick={() => { setTab('join'); setError('') }}
            className={`py-2.5 rounded-lg font-hud font-bold tracking-widest text-sm transition-all ${
              tab === 'join'
                ? 'bg-rose-500/20 text-rose-300 ring-1 ring-rose-400/50'
                : 'bg-slate-800/60 text-slate-500 hover:text-slate-300'
            }`}
          >
            加入房间
          </button>
        </div>

        {tab === 'create' ? (
          <div className="pk-panel p-6">
            {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
            <button
              onClick={handleCreate}
              disabled={busy}
              className="w-full py-3.5 rounded-lg font-bold text-white transition-all pk-btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? '创建中...' : '⚔️ 创建房间'}
            </button>
            <p className="text-center text-[11px] text-slate-500 mt-3">
              创建后分享房间号给好友即可开始对战
            </p>
          </div>
        ) : (
          <div className="pk-panel p-6">
            <label className="block font-hud text-xs tracking-widest text-slate-400 uppercase mb-3 text-center">
              输入 4 位房间号
            </label>
            <input
              type="text"
              maxLength={4}
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              placeholder="····"
              className="w-full text-center font-display text-3xl font-bold tracking-[0.6em] bg-slate-900/70 border border-slate-600 focus:border-rose-400 rounded-lg px-4 py-3 text-rose-300 placeholder-slate-700 focus:outline-none transition-colors uppercase"
            />
            {error && <p className="text-red-400 text-xs mt-2 text-center">{error}</p>}
            <button
              onClick={handleJoin}
              disabled={joinCode.length !== 4 || busy}
              className="w-full mt-4 py-3.5 rounded-lg font-bold text-white transition-all pk-btn-join disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? '加入中...' : '🚪 加入对战'}
            </button>
            <p className="text-center text-[11px] text-slate-500 mt-3">
              向房主索要房间号，或点击邀请链接自动加入
            </p>
          </div>
        )}

        {/* 规则说明 */}
        <div className="mt-auto pt-6 text-center text-[11px] text-slate-600 space-y-1">
          <p>双方共享同一目标 · 先让目标进入视野者获胜</p>
          <p>倒计时结束按距离与提示扣分判定胜负</p>
        </div>
      </div>
    </div>
  )
}
