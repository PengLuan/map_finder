import { useState, useEffect, useCallback } from 'react'
import { adminApi } from '../../api/admin'
import type { CollectionPoiItem, AdminPOI, AdminPOIInput, AdminTheme } from '../../types/admin'
import POIEditor from '../../components/admin/POIEditor'

interface Props {
  collectionId: number
  collectionName: string
  onClose: () => void
  onSaved: () => void
  onAuthError: () => void
}

export default function CollectionPoisEditor({ collectionId, collectionName, onClose, onSaved, onAuthError }: Props) {
  const [pois, setPois] = useState<CollectionPoiItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // 添加点位搜索
  const [searchKw, setSearchKw] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<AdminPOI[]>([])
  const [themes, setThemes] = useState<AdminTheme[]>([])
  const [editingPoi, setEditingPoi] = useState<AdminPOI | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    adminApi
      .listCollectionPois(collectionId)
      .then((res) => setPois(res.items))
      .catch((e: Error) => {
        if (e.message.includes('未登录')) onAuthError()
        else setError(e.message)
      })
      .finally(() => setLoading(false))
  }, [collectionId, onAuthError])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    adminApi.listThemes(true).then(setThemes).catch(() => {})
  }, [])

  const openEditPoi = (poiId: number) => {
    setError('')
    adminApi
      .getPoi(poiId)
      .then((poi) => setEditingPoi(poi))
      .catch((e: Error) => {
        if (e.message.includes('未登录')) onAuthError()
        else setError(e.message)
      })
  }

  const handlePoiSave = (input: AdminPOIInput) => {
    if (!editingPoi) return
    adminApi
      .updatePoi(editingPoi.id, input)
      .then(() => {
        setEditingPoi(null)
        load()
      })
      .catch((e: Error) => {
        if (e.message.includes('未登录')) onAuthError()
        else setError(e.message)
      })
  }

  const doSearch = useCallback(() => {
    if (!searchKw.trim()) { setResults([]); return }
    setSearching(true)
    adminApi
      .listPois({ keyword: searchKw.trim(), page: 1, page_size: 10 })
      .then((res) => setResults(res.items))
      .catch((e: Error) => {
        if (e.message.includes('未登录')) onAuthError()
        else setError(e.message)
      })
      .finally(() => setSearching(false))
  }, [searchKw, onAuthError])

  const move = (index: number, dir: -1 | 1) => {
    setPois((prev) => {
      const next = [...prev]
      const j = index + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[index], next[j]] = [next[j], next[index]]
      return next
    })
  }

  const remove = (index: number) => {
    setPois((prev) => prev.filter((_, i) => i !== index))
  }

  const addPoi = (p: AdminPOI) => {
    setPois((prev) => {
      if (prev.some((x) => x.poi_id === p.id)) return prev
      return [...prev, {
        poi_id: p.id,
        name: p.name,
        lng: p.lng,
        lat: p.lat,
        cover_url: p.cover_url ?? null,
        difficulty: p.difficulty,
        sort_order: prev.length,
      }]
    })
  }

  const handleSave = () => {
    setSaving(true)
    setError('')
    adminApi
      .setCollectionPois(collectionId, pois.map((p) => p.poi_id))
      .then(() => onSaved())
      .catch((e: Error) => {
        if (e.message.includes('未登录')) onAuthError()
        else setError(e.message)
      })
      .finally(() => setSaving(false))
  }

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl p-5 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-slate-100">点位编辑 - {collectionName}</h3>
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-sm rounded-lg">
              {loading ? '刷新中…' : '↻ 刷新'}
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-xl leading-none">×</button>
          </div>
        </div>

        {error && <div className="mb-3 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex-1 min-h-0 overflow-auto space-y-4">
          {/* 当前点位列表 */}
          <div>
            <div className="text-xs text-slate-400 mb-2">当前点位（共 {pois.length} 个，按收集顺序）</div>
            {loading && <div className="py-6 text-center text-slate-400 text-sm">加载中…</div>}
            {!loading && pois.length === 0 && <div className="py-6 text-center text-slate-500 text-sm">暂无点位</div>}
            {!loading && pois.map((p, i) => (
              <div key={`${p.poi_id}-${i}`} className="flex items-center gap-2 py-1.5 border-b border-slate-700/50 text-sm">
                <span className="w-6 text-slate-500 text-xs text-right">{i + 1}.</span>
                <span className="flex-1 text-slate-200 truncate">{p.name}</span>
                <span className="text-xs text-slate-500">{p.lng.toFixed(3)}, {p.lat.toFixed(3)}</span>
                <button onClick={() => move(i, -1)} disabled={i === 0}
                  className="text-xs px-1.5 py-0.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-30 text-slate-200 rounded">↑</button>
                <button onClick={() => move(i, 1)} disabled={i === pois.length - 1}
                  className="text-xs px-1.5 py-0.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-30 text-slate-200 rounded">↓</button>
                <button onClick={() => openEditPoi(p.poi_id)}
                  className="text-xs px-2 py-0.5 bg-cyan-700/70 hover:bg-cyan-600 text-white rounded">编辑</button>
                <button onClick={() => remove(i)}
                  className="text-xs px-1.5 py-0.5 bg-red-600/70 hover:bg-red-500 text-white rounded">删</button>
              </div>
            ))}
          </div>

          {/* 添加点位 */}
          <div>
            <div className="text-xs text-slate-400 mb-2">添加点位</div>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={searchKw}
                onChange={(e) => setSearchKw(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') doSearch() }}
                placeholder="搜索 POI 名称"
                className="flex-1 px-3 py-1.5 bg-slate-900/60 border border-slate-600 rounded-lg text-sm text-slate-200 outline-none focus:border-cyan-400"
              />
              <button onClick={doSearch} disabled={searching}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-sm rounded-lg">
                {searching ? '搜索中…' : '搜索'}
              </button>
            </div>
            {results.length > 0 && (
              <div className="space-y-1">
                {results.map((p) => (
                  <button key={p.id} onClick={() => addPoi(p)}
                    className="w-full flex items-center gap-2 py-1.5 px-2 bg-slate-900/50 hover:bg-slate-700/40 rounded-lg text-left text-sm text-slate-300">
                    <span className="flex-1 truncate">{p.name}</span>
                    <span className="text-xs text-slate-500">{p.lng.toFixed(2)}, {p.lat.toFixed(2)}</span>
                    <span className="text-xs text-cyan-400">+ 添加</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-700">
          <button onClick={onClose}
            className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg">取消</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm rounded-lg">
            {saving ? '保存中…' : `保存（${pois.length} 个点位）`}
          </button>
        </div>
      </div>
    </div>
      {editingPoi && (
        <POIEditor
          key={`poi-${editingPoi.id}`}
          poi={editingPoi}
          themes={themes}
          onSave={handlePoiSave}
          onCancel={() => setEditingPoi(null)}
        />
      )}
    </>
  )
}
