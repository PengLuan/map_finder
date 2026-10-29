import { useEffect, useRef } from 'react'

interface Options {
  /** 轮询间隔（毫秒） */
  interval: number
  /** 是否启用 */
  enabled: boolean
  /** 版本号字段名，用于乐观锁去重；不传则每次都更新 */
  versionKey?: string
}

/**
 * 通用轮询 Hook：按固定间隔调用 fetcher，通过 version 字段做乐观锁，
 * 只有版本号变化（或 alwaysUpdate）才触发 onUpdate，减少无效渲染。
 * 页面不可见时自动跳过请求。
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  onUpdate: (data: T) => void,
  { interval, enabled, versionKey }: Options
) {
  const lastVersionRef = useRef<number | null>(null)
  const fetcherRef = useRef(fetcher)
  const onUpdateRef = useRef(onUpdate)

  fetcherRef.current = fetcher
  onUpdateRef.current = onUpdate

  useEffect(() => {
    if (!enabled) return

    let timer: ReturnType<typeof setInterval> | null = null

    const tick = async () => {
      if (document.hidden) return
      try {
        const data = await fetcherRef.current()
        if (versionKey) {
          const version = (data as Record<string, unknown>)[versionKey] as number
          if (lastVersionRef.current !== null && version === lastVersionRef.current) {
            return
          }
          lastVersionRef.current = version
        }
        onUpdateRef.current(data)
      } catch {
        // 轮询失败静默忽略，下一轮重试
      }
    }

    tick()
    timer = setInterval(tick, interval)

    return () => {
      if (timer) clearInterval(timer)
      lastVersionRef.current = null
    }
  }, [enabled, interval, versionKey])
}
