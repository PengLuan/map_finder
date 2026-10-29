import { useState, useCallback, useEffect } from 'react'
import { pkApi, getStoredUser } from '../api/pk'
import { api } from '../api'
import { usePolling } from '../hooks/usePolling'
import { useHeartbeat } from '../hooks/useHeartbeat'
import type { RoomStatus } from '../types/pk'

interface Props {
  roomId: number
  roomCode: string
  isHost: boolean
  onLeave: () => void
  onEnterGame: (gameId: number, startCover?: string | null) => void
}

const MODE_NAMES: Record<string, string> = {
  national: '全国模式',
  provincial: '省级模式',
  city: '城市模式',
}

export default function PKRoom({ roomId, roomCode, isHost, onLeave, onEnterGame }: Props) {
  const [room, setRoom] = useState<RoomStatus | null>(null)
  const [copied, setCopied] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [themeNames, setThemeNames] = useState<Record<string, string>>({})

  const me = getStoredUser()

  useEffect(() => {
    api
      .getThemes()
      .then((list) => {
        const map: Record<string, string> = {}
        for (const t of list) map[t.code] = `${t.icon || ''} ${t.name}`.trim()
        setThemeNames(map)
      })
      .catch(() => {})
  }, [])

  // 轮询房间状态（2 秒，version 乐观锁）
  usePolling<RoomStatus>(
    () => pkApi.getRoomStatus(roomId),
    (data) => {
      setRoom(data)
      // 房客：房主已开始游戏 → 进入对战
      if (!isHost && data.status === 'playing' && data.game_id) {
        onEnterGame(data.game_id)
      }
      // 房间结束：有 game_id 时进入结算页面，否则返回大厅
      if (data.status === 'finished') {
        if (data.game_id) {
          onEnterGame(data.game_id)
        } else {
          onLeave()
        }
      }
    },
    { interval: 2000, enabled: true, versionKey: 'version' }
  )

  // 心跳
  useHeartbeat(roomId, true)

  const handleStart = useCallback(async () => {
    setStarting(true)
    setError('')
    try {
      const res = await pkApi.startGame(roomId)
      onEnterGame(res.game_id, res.target_cover ?? null)
    } catch (e: any) {
      setError(e.message)
      setStarting(false)
    }
  }, [roomId, onEnterGame])

  const handleLeave = useCallback(async () => {
    try {
      await pkApi.leaveRoom(roomId)
    } catch {
      // 忽略离开失败
    }
    onLeave()
  }, [roomId, onLeave])

  const copyInvite = useCallback(() => {
    const url = `${window.location.origin}${window.location.pathname}?pk=${roomCode}`
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => {
        // 降级：直接复制房间号
        navigator.clipboard.writeText(roomCode).catch(() => {})
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
  }, [roomCode])

  const host = room?.players.find((p) => p.user_id !== undefined)
  const guest = room?.players[1]
  const guestJoined = !!guest

  return (
    <div className="pk-bg h-full flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div className="relative z-10 w-full max-w-md">
        {/* 模式 / 难度标签 */}
        <div className="text-center mb-6 flex items-center justify-center gap-2">
          <span className="inline-block font-hud text-xs tracking-[0.3em] text-slate-400 uppercase border border-slate-700 rounded-full px-4 py-1">
            {MODE_NAMES[room?.mode || 'national'] || '对战房间'}
          </span>
          {room && (
            <span
              className={`inline-block font-hud text-xs rounded-full px-3 py-1 border ${
                room.difficulty === 'easy'
                  ? 'text-emerald-300 border-emerald-400/40 bg-emerald-500/10'
                  : 'text-rose-300 border-rose-400/40 bg-rose-500/10'
              }`}
            >
              {room.difficulty === 'easy' ? '点选' : '巡航'}
            </span>
          )}
          {room?.category && (
            <span className="inline-block font-hud text-xs rounded-full px-3 py-1 border text-cyan-300 border-cyan-400/40 bg-cyan-500/10">
              {themeNames[room.category] || room.category}
            </span>
          )}
        </div>

        {/* 房间号 */}
        <div className="pk-panel p-8 text-center mb-4">
          <div className="font-hud text-xs tracking-[0.4em] text-slate-500 uppercase mb-3">
            房间号
          </div>
          <div className="font-display text-5xl font-black tracking-[0.3em] pk-code-text mb-5">
            {roomCode}
          </div>

          <button
            onClick={copyInvite}
            className="inline-flex items-center gap-2 text-sm px-5 py-2 rounded-lg border border-slate-600 hover:border-cyan-400 hover:text-cyan-300 text-slate-300 transition-all"
          >
            {copied ? '✓ 已复制邀请链接' : '📋 复制邀请链接'}
          </button>
        </div>

        {/* 玩家席位 */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 mb-6">
          {/* 房主 */}
          <PlayerSlot
            nickname={me?.nickname || '房主'}
            isMe={isHost}
            color="cyan"
            label="房主"
            ready
          />

          {/* VS */}
          <div className="font-display text-2xl font-black pk-vs-text">VS</div>

          {/* 房客 */}
          {guestJoined ? (
            <PlayerSlot
              nickname={guest.nickname}
              isMe={!isHost}
              color="rose"
              label="挑战者"
              ready
            />
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className="w-14 h-14 rounded-full border-2 border-dashed border-slate-600 flex items-center justify-center">
                <span className="w-3 h-3 rounded-full bg-slate-500 animate-ping" />
              </div>
              <span className="text-xs text-slate-500">等待加入...</span>
            </div>
          )}
        </div>

        {/* 错误提示 */}
        {error && <p className="text-red-400 text-xs text-center mb-3">{error}</p>}

        {/* 操作按钮 */}
        {isHost ? (
          <button
            onClick={handleStart}
            disabled={!guestJoined || starting}
            className="w-full py-4 rounded-lg font-bold text-lg text-white transition-all pk-btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {starting ? '正在开局...' : guestJoined ? '⚔️ 开始对战' : '等待对手加入...'}
          </button>
        ) : (
          <div className="text-center text-sm text-slate-400 py-3">
            <span className="inline-block animate-pulse">等待房主开始游戏</span>
          </div>
        )}

        {/* 离开 */}
        <button
          onClick={handleLeave}
          className="w-full mt-3 py-2 text-sm text-slate-500 hover:text-red-400 transition-colors"
        >
          离开房间
        </button>
      </div>
    </div>
  )
}

function PlayerSlot({
  nickname,
  isMe,
  color,
  label,
  ready,
}: {
  nickname: string
  isMe: boolean
  color: 'cyan' | 'rose'
  label: string
  ready: boolean
}) {
  const ring = color === 'cyan' ? 'ring-cyan-400/60 bg-cyan-500/15' : 'ring-rose-400/60 bg-rose-500/15'
  const text = color === 'cyan' ? 'text-cyan-300' : 'text-rose-300'
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`w-14 h-14 rounded-full ring-2 ${ring} flex items-center justify-center text-xl font-bold ${text} transition-all ${
          ready ? 'scale-100' : 'scale-90 opacity-60'
        }`}
      >
        {nickname.slice(0, 1).toUpperCase()}
      </div>
      <div className="text-center">
        <div className={`text-sm font-medium ${text} max-w-[90px] truncate`}>
          {nickname}
          {isMe && <span className="text-[10px] text-slate-500 ml-1">(我)</span>}
        </div>
        <div className="text-[10px] text-slate-500">{label}</div>
      </div>
    </div>
  )
}
