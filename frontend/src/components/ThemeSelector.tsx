import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Theme } from '../types'

interface Props {
  value: string | null
  onChange: (code: string | null) => void
}

export default function ThemeSelector({ value, onChange }: Props) {
  const [themes, setThemes] = useState<Theme[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    api
      .getThemes()
      .then((list) => setThemes(list.filter((t) => t.poi_count > 0)))
      .catch(console.error)
      .finally(() => setLoaded(true))
  }, [])

  if (!loaded) {
    return <div className="text-xs text-slate-500 py-2">主题加载中...</div>
  }
  if (themes.length === 0) return null

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {themes.map((t) => (
        <button
          key={t.code}
          onClick={() => onChange(t.code)}
          className={`relative rounded-xl overflow-hidden border-2 transition-all text-left group ${
            value === t.code
              ? 'border-cyan-400 shadow-lg shadow-cyan-500/20'
              : 'border-slate-600 hover:border-slate-400'
          }`}
        >
          <div className="aspect-[16/9] bg-slate-700">
            {t.cover_url && (
              <img
                src={t.cover_url}
                alt={t.name}
                loading="lazy"
                className="w-full h-full object-cover"
              />
            )}
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/20 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-2.5">
            <div className="text-base font-bold text-white leading-tight">
              {t.icon} {t.name}
            </div>
            <div className="text-xs text-slate-300 mt-1 line-clamp-1">{t.description}</div>
            <div className="text-xs text-cyan-300 mt-1">{t.poi_count} 个目标</div>
          </div>
          {value === t.code && (
            <div className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-cyan-400 text-slate-900 text-sm font-bold flex items-center justify-center">
              ✓
            </div>
          )}
        </button>
      ))}

      {/* 更多主题占位 */}
      <div className="aspect-[16/9] rounded-xl border-2 border-dashed border-slate-600 bg-slate-800/40 flex flex-col items-center justify-center text-slate-500">
        <span className="text-2xl mb-1">✨</span>
        <span className="text-sm font-bold">更多主题</span>
        <span className="text-[10px] mt-0.5">敬请期待</span>
      </div>
    </div>
  )
}
