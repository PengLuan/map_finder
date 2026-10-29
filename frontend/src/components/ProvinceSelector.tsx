import { useState } from 'react'
import type { Region } from '../types'

interface Props {
  provinces: Region[]
  value: string | null
  onChange: (code: string | null) => void
}

/**
 * 省份卡片选择器：图片已预合成（景点照片 + 省轮廓 + 省名 + 景点名）。
 * 图片文件位于 public/provinces/{adcode}.jpg。
 */
export default function ProvinceSelector({ provinces, value, onChange }: Props) {
  const [imgErrors, setImgErrors] = useState<Set<string>>(new Set())

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {provinces.map((p) => {
        const selected = value === p.code
        const imgOk = !imgErrors.has(p.code)
        return (
          <button
            key={p.code}
            onClick={() => onChange(p.code)}
            className={`relative rounded-xl overflow-hidden border-2 transition-all text-left group ${
              selected
                ? 'border-cyan-400 shadow-lg shadow-cyan-500/20'
                : 'border-slate-600 hover:border-slate-400'
            }`}
          >
            <div className="aspect-[16/9] bg-slate-700">
              {imgOk ? (
                <img
                  src={`https://map-find.oss-cn-beijing.aliyuncs.com/covers/provinces/${p.code.substring(0, 6)}.jpg`}
                  alt={p.name}
                  loading="lazy"
                  className="w-full h-full object-cover"
                  onError={() =>
                    setImgErrors((prev) => new Set(prev).add(p.code))
                  }
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
                  {p.name}
                </div>
              )}
            </div>

            {/* 选中标记 */}
            {selected && (
              <div className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-cyan-400 text-slate-900 text-sm font-bold flex items-center justify-center shadow-lg">
                ✓
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}
