import { useEffect } from 'react'
import { pkApi } from '../api/pk'

const HEARTBEAT_INTERVAL = 15000

/**
 * 心跳 Hook：进入房间/游戏时立即发一次心跳，之后按 interval 间隔发一次，
 * 供服务端判断玩家是否在线。
 *
 * 注意：即使页面不可见（document.hidden）也持续发送心跳。
 * 心跳是证明玩家仍在线的唯一信号，若 hidden 时跳过，
 * 玩家短暂切到其他标签页/App 会导致对手误判"已离开"。
 * 页面真正关闭时 setInterval 自然停止，无需在此额外处理。
 */
export function useHeartbeat(roomId: number | null, enabled: boolean, interval: number = HEARTBEAT_INTERVAL) {
  useEffect(() => {
    if (!enabled || !roomId) return

    pkApi.heartbeat(roomId).catch(() => {})

    const timer = setInterval(() => {
      pkApi.heartbeat(roomId).catch(() => {})
    }, interval)

    return () => clearInterval(timer)
  }, [roomId, enabled, interval])
}
