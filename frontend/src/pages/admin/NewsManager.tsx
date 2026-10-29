/**
 * NewsManager — 新闻时间线管理
 * 时间线 CRUD + 新闻 POI 核定（坐标核实 verified / 审核状态 approved）
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { adminApi } from '../../api/admin'
import type { NewsTimelineItem, NewsTimelineInput, NewsPoiItem, NewsPoiInput, NewsStats, NewsCorrectionItem } from '../../api/admin'
import { api } from '../../api'
import CoordPickerMap from './CoordPickerMap'

/**
 * CoverUploadField — 封面图字段：URL 手填 / 本地上传（走 /api/upload 存 OSS）+ 缩略预览
 */
function CoverUploadField({ value, onChange, placeholder }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = (f: File | undefined) => {
    if (!f) return
    setUploading(true)
    setErr('')
    api.uploadCover(f)
      .then((r) => onChange(r.url))
      .catch((e: Error) => setErr(e.message || '上传失败'))
      .finally(() => setUploading(false))
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <input
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm"
          placeholder={placeholder ?? '图片 URL，或点右侧上传'}
        />
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { handleFile(e.target.files?.[0]); e.currentTarget.value = '' }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="shrink-0 px-3 py-2 rounded-lg text-xs font-bold bg-cyan-600/20 text-cyan-300 border border-cyan-600/40 hover:bg-cyan-600/30 disabled:opacity-50 whitespace-nowrap"
        >
          {uploading ? '上传中...' : '⬆ 上传图片'}
        </button>
      </div>
      {err && <p className="text-rose-400 text-xs">{err}</p>}
      {value && (
        <img src={value} alt="封面预览" className="h-20 rounded-lg border border-slate-600 object-cover" />
      )}
    </div>
  )
}

interface Props {
  onAuthError: () => void
}

const EMPTY_TL: NewsTimelineInput = {
  code: '', name: '', description: '', color: '#dc2626', cover_url: '',
  medal_icon_url: '', batch: '2026-10', sort_order: 0, audit_status: 'pending', enabled: true,
}

const EMPTY_POI: NewsPoiInput = {
  name: '', event_date: '', event_text: '', fact_text: '', hint_text: '',
  link_url: '', link_source: '', lng: 0, lat: 0, region: '',
  difficulty: 3, cover_url: '', sort_order: 0, verified: false, status: 'pending',
}

const statusBadge = (s: string) =>
  s === 'approved'
    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40'
    : s === 'rejected'
      ? 'bg-rose-500/15 text-rose-300 border border-rose-500/40'
      : 'bg-amber-500/15 text-amber-300 border border-amber-500/40'

export default function NewsManager({ onAuthError }: Props) {
  const [timelines, setTimelines] = useState<NewsTimelineItem[]>([])
  const [stats, setStats] = useState<NewsStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showTlForm, setShowTlForm] = useState(false)
  const [tlEditing, setTlEditing] = useState<NewsTimelineItem | null>(null)
  const [tlForm, setTlForm] = useState<NewsTimelineInput>(EMPTY_TL)
  const [confirmDelete, setConfirmDelete] = useState<NewsTimelineItem | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // POI 编辑器
  const [poiTimeline, setPoiTimeline] = useState<NewsTimelineItem | null>(null)
  const [pois, setPois] = useState<NewsPoiItem[]>([])
  const [poisLoading, setPoisLoading] = useState(false)
  const [poiForm, setPoiForm] = useState<NewsPoiInput | null>(null)
  const [poiEditingId, setPoiEditingId] = useState<number | null>(null)
  const [poiSaving, setPoiSaving] = useState(false)
  const [poiError, setPoiError] = useState('')

  // 纠错反馈
  const [showCorrections, setShowCorrections] = useState(false)
  const [corrections, setCorrections] = useState<NewsCorrectionItem[]>([])
  const [corrLoading, setCorrLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    Promise.all([
      adminApi.listNewsTimelines(),
      adminApi.getNewsStats(),
    ])
      .then(([tl, st]) => {
        setTimelines(tl.items)
        setStats(st)
      })
      .catch((e: Error) => {
        if (e.message.includes('未登录')) { onAuthError(); return }
        setError(e.message)
      })
      .finally(() => setLoading(false))
  }, [onAuthError])

  useEffect(() => { load() }, [load])

  const openTlForm = (t?: NewsTimelineItem) => {
    setTlEditing(t ?? null)
    setTlForm(t ? {
      code: t.code, name: t.name, description: t.description ?? '',
      color: t.color ?? '', cover_url: t.cover_url ?? '',
      medal_icon_url: t.medal_icon_url ?? '', batch: t.batch ?? '',
      sort_order: t.sort_order, audit_status: t.audit_status, enabled: t.enabled,
    } : EMPTY_TL)
    setFormError('')
    setShowTlForm(true)
  }

  const saveTl = () => {
    if (!tlForm.code.trim() || !tlForm.name.trim()) {
      setFormError('code 和 name 必填')
      return
    }
    setSaving(true)
    setFormError('')
    const action = tlEditing
      ? adminApi.updateNewsTimeline(tlEditing.id, tlForm)
      : adminApi.createNewsTimeline(tlForm)
    action
      .then(() => { setShowTlForm(false); load() })
      .catch((e: Error) => {
        if (e.message.includes('未登录')) { onAuthError(); return }
        setFormError(e.message)
      })
      .finally(() => setSaving(false))
  }

  const deleteTl = () => {
    if (!confirmDelete) return
    setSaving(true)
    adminApi.deleteNewsTimeline(confirmDelete.id)
      .then(() => { setConfirmDelete(null); load() })
      .catch((e: Error) => {
        if (e.message.includes('未登录')) { onAuthError(); return }
        setError(e.message)
      })
      .finally(() => setSaving(false))
  }

  const quickTlUpdate = (t: NewsTimelineItem, field: 'audit_status' | 'enabled', value: unknown) => {
    adminApi.updateNewsTimeline(t.id, {
      code: t.code, name: t.name, description: t.description, color: t.color,
      cover_url: t.cover_url, medal_icon_url: t.medal_icon_url, batch: t.batch,
      sort_order: t.sort_order,
      audit_status: t.audit_status, enabled: t.enabled, [field]: value,
    }).then(load).catch((e: Error) => {
      if (e.message.includes('未登录')) { onAuthError(); return }
      setError(e.message)
    })
  }

  const openPois = (t: NewsTimelineItem) => {
    setPoiTimeline(t)
    setPoisLoading(true)
    adminApi.listNewsPois(t.id)
      .then((res) => setPois(res.items))
      .catch((e: Error) => {
        if (e.message.includes('未登录')) { onAuthError(); return }
        setError(e.message)
      })
      .finally(() => setPoisLoading(false))
  }

  const reloadPois = () => {
    if (!poiTimeline) return
    adminApi.listNewsPois(poiTimeline.id)
      .then((res) => setPois(res.items))
      .catch(() => {})
  }

  const openPoiForm = (p?: NewsPoiItem) => {
    setPoiError('')
    if (p) {
      setPoiEditingId(p.id)
      setPoiForm({
        name: p.name, event_date: p.event_date ?? '', event_text: p.event_text ?? '',
        fact_text: p.fact_text ?? '', hint_text: p.hint_text ?? '',
        link_url: p.link_url ?? '', link_source: p.link_source ?? '',
        lng: p.lng, lat: p.lat, region: p.region ?? '',
        difficulty: p.difficulty, cover_url: p.cover_url ?? '',
        sort_order: p.sort_order, verified: p.verified, status: p.status,
      })
    } else {
      setPoiEditingId(null)
      setPoiForm({
        ...EMPTY_POI,
        sort_order: pois.length ? Math.max(...pois.map((x) => x.sort_order)) + 1 : 1,
      })
    }
  }

  const savePoi = () => {
    if (!poiForm || !poiTimeline) return
    if (!poiForm.name.trim()) { setPoiError('name 必填'); return }
    setPoiSaving(true)
    setPoiError('')
    const action = poiEditingId
      ? adminApi.updateNewsPoi(poiEditingId, poiForm)
      : adminApi.createNewsPoi({ ...poiForm, timeline_id: poiTimeline.id })
    action
      .then(() => { setPoiForm(null); reloadPois(); load() })
      .catch((e: Error) => {
        if (e.message.includes('未登录')) { onAuthError(); return }
        setPoiError(e.message)
      })
      .finally(() => setPoiSaving(false))
  }

  const deletePoi = (p: NewsPoiItem) => {
    adminApi.deleteNewsPoi(p.id).then(() => { reloadPois(); load() })
      .catch((e: Error) => {
        if (e.message.includes('未登录')) { onAuthError(); return }
        setError(e.message)
      })
  }

  const openCorrections = () => {
    setShowCorrections(true)
    setCorrLoading(true)
    adminApi.listNewsCorrections()
      .then((res) => setCorrections(res.items))
      .catch((e: Error) => {
        if (e.message.includes('未登录')) { onAuthError(); return }
        setError(e.message)
      })
      .finally(() => setCorrLoading(false))
  }

  const handleCorrection = (id: number) => {
    adminApi.handleNewsCorrection(id)
      .then(() => {
        setCorrections((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'handled' as const } : c)))
      })
      .catch((e: Error) => {
        if (e.message.includes('未登录')) { onAuthError(); return }
        setError(e.message)
      })
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold">📰 新闻时间线管理</h2>
          {stats && (
            <p className="text-xs text-slate-400 mt-1">
              待核定 POI <span className="text-amber-300 font-bold">{stats.pending_pois}</span> 个 ·
              坐标未核实 <span className="text-amber-300 font-bold">{stats.unverified_pois}</span> 个 ·
              累计找点记录 {stats.found_records} 条
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openCorrections} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-bold">
            📨 用户反馈
          </button>
          <button onClick={() => openTlForm()} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-bold">
            + 新建时间线
          </button>
        </div>
      </div>

      {error && <div className="text-rose-400 text-sm">{error}</div>}

      <div className="bg-slate-800/60 rounded-xl border border-slate-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-slate-400 border-b border-slate-700">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">时间线</th>
              <th className="px-3 py-2.5 text-left font-medium">批次</th>
              <th className="px-3 py-2.5 text-center font-medium">POI（已核准/已核实）</th>
              <th className="px-3 py-2.5 text-center font-medium">上线状态</th>
              <th className="px-3 py-2.5 text-center font-medium">审核</th>
              <th className="px-3 py-2.5 text-center font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">加载中...</td></tr>
            )}
            {!loading && timelines.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">暂无时间线</td></tr>
            )}
            {timelines.map((t) => (
              <tr key={t.id} className="border-b border-slate-700/50 last:border-0 hover:bg-slate-800/40">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: t.color ?? '#64748b' }} />
                    <div>
                      <div className="font-bold text-slate-100">{t.name}</div>
                      <div className="text-xs text-slate-500">{t.code}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-slate-400 text-xs">{t.batch ?? '-'}</td>
                <td className="px-3 py-2.5 text-center">
                  <span className="text-slate-200">{t.poi_count}</span>
                  <span className="text-slate-500">（</span>
                  <span className={t.approved_count === t.poi_count && t.poi_count > 0 ? 'text-emerald-300' : 'text-amber-300'}>{t.approved_count}</span>
                  <span className="text-slate-500">/</span>
                  <span className={t.verified_count === t.poi_count && t.poi_count > 0 ? 'text-emerald-300' : 'text-amber-300'}>{t.verified_count}</span>
                  <span className="text-slate-500">）</span>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <button
                    onClick={() => quickTlUpdate(t, 'enabled', !t.enabled)}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                      t.enabled
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                        : 'bg-slate-600/20 text-slate-400 border-slate-600'
                    }`}
                  >
                    {t.enabled ? '已上线' : '已下线'}
                  </button>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <select
                    value={t.audit_status}
                    onChange={(e) => quickTlUpdate(t, 'audit_status', e.target.value)}
                    className={`rounded-md px-2 py-1 text-xs bg-slate-900 border ${statusBadge(t.audit_status)}`}
                  >
                    <option value="pending">待审核</option>
                    <option value="approved">已审核</option>
                  </select>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex items-center justify-center gap-2 text-xs">
                    <button onClick={() => openPois(t)} className="px-2.5 py-1 rounded-md bg-cyan-600/20 text-cyan-300 hover:bg-cyan-600/30 border border-cyan-600/40">
                      POI 核定
                    </button>
                    <button onClick={() => openTlForm(t)} className="px-2.5 py-1 rounded-md bg-slate-700 hover:bg-slate-600">
                      编辑
                    </button>
                    <button onClick={() => setConfirmDelete(t)} className="px-2.5 py-1 rounded-md bg-rose-600/20 text-rose-300 hover:bg-rose-600/30 border border-rose-600/40">
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 时间线表单弹窗 */}
      {showTlForm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowTlForm(false)}>
          <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-lg p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-base">{tlEditing ? '编辑时间线' : '新建时间线'}</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-slate-400 space-y-1">code *
                <input value={tlForm.code} onChange={(e) => setTlForm({ ...tlForm, code: e.target.value })}
                  className="w-full mt-0.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm" placeholder="oct_t1" />
              </label>
              <label className="text-xs text-slate-400 space-y-1">名称 *
                <input value={tlForm.name} onChange={(e) => setTlForm({ ...tlForm, name: e.target.value })}
                  className="w-full mt-0.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm" />
              </label>
            </div>
            <label className="block text-xs text-slate-400 space-y-1">描述
              <textarea value={tlForm.description ?? ''} rows={2} onChange={(e) => setTlForm({ ...tlForm, description: e.target.value })}
                className="w-full mt-0.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm" />
            </label>
            <div className="grid grid-cols-4 gap-3">
              <label className="text-xs text-slate-400 space-y-1">主题色
                <input value={tlForm.color ?? ''} onChange={(e) => setTlForm({ ...tlForm, color: e.target.value })}
                  className="w-full mt-0.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm" placeholder="#dc2626" />
              </label>
              <label className="text-xs text-slate-400 space-y-1">批次
                <input value={tlForm.batch ?? ''} onChange={(e) => setTlForm({ ...tlForm, batch: e.target.value })}
                  className="w-full mt-0.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm" placeholder="2026-10" />
              </label>
              <label className="text-xs text-slate-400 space-y-1">排序
                <input type="number" value={tlForm.sort_order} onChange={(e) => setTlForm({ ...tlForm, sort_order: Number(e.target.value) })}
                  className="w-full mt-0.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm" />
              </label>
              <label className="text-xs text-slate-400 space-y-1">审核
                <select value={tlForm.audit_status} onChange={(e) => setTlForm({ ...tlForm, audit_status: e.target.value as NewsTimelineInput['audit_status'] })}
                  className="w-full mt-0.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm">
                  <option value="pending">待审核</option>
                  <option value="approved">已审核</option>
                </select>
              </label>
            </div>
            <div className="text-xs text-slate-400 space-y-1">封面图（时间线卡片配图）
              <CoverUploadField
                value={tlForm.cover_url ?? ''}
                onChange={(v) => setTlForm({ ...tlForm, cover_url: v })}
                placeholder="/news/oct_t1.jpg 或 https://..."
              />
            </div>
            <div className="text-xs text-slate-400 space-y-1">勋章图标（找齐纪念勋章，空则显示默认 🏅）
              <CoverUploadField
                value={tlForm.medal_icon_url ?? ''}
                onChange={(v) => setTlForm({ ...tlForm, medal_icon_url: v })}
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={tlForm.enabled} onChange={(e) => setTlForm({ ...tlForm, enabled: e.target.checked })} />
              启用（上线显示）
            </label>
            {formError && <p className="text-rose-400 text-xs">{formError}</p>}
            <div className="flex gap-2 pt-1">
              <button onClick={saveTl} disabled={saving} className="flex-1 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-lg text-sm font-bold">
                {saving ? '保存中...' : '保存'}
              </button>
              <button onClick={() => setShowTlForm(false)} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm">取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认 */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setConfirmDelete(null)}>
          <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-sm p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm mb-1">确认删除时间线？</p>
            <p className="text-xs text-slate-400 mb-4">{confirmDelete.name}（含 {confirmDelete.poi_count} 个 POI 与找点进度，不可恢复）</p>
            <div className="flex gap-2">
              <button onClick={deleteTl} disabled={saving} className="flex-1 py-2 bg-rose-600 hover:bg-rose-500 rounded-lg text-sm font-bold">确认删除</button>
              <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm">取消</button>
            </div>
          </div>
        </div>
      )}

      {/* POI 核定弹窗 */}
      {poiTimeline && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setPoiTimeline(null)}>
          <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-3xl max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold">POI 核定 · {poiTimeline.name}</h3>
              <button onClick={() => setPoiTimeline(null)} className="text-slate-400 hover:text-white text-lg px-2">×</button>
            </div>
            <p className="text-xs text-slate-400 mb-4">核定流程：核对坐标（点"高德拾取"比对位置）→ 勾选"坐标已核实" → 状态改为"已核定"</p>
            {poisLoading ? (
              <p className="text-slate-400 text-sm py-6 text-center">加载中...</p>
            ) : (
              <div className="space-y-2">
                {pois.map((p) => (
                  <div key={p.id} className="bg-slate-900/60 rounded-xl border border-slate-700 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-slate-500">#{p.sort_order}</span>
                          <span className="font-bold text-sm">{p.name}</span>
                          <span className="text-xs text-slate-500">{p.event_date}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] ${statusBadge(p.status)}`}>
                            {p.status === 'approved' ? '已核定' : p.status === 'rejected' ? '已驳回' : '待核定'}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] border ${
                            p.verified ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                          }`}>
                            {p.verified ? '坐标已核实' : '坐标未核实'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1 truncate">提示：{p.hint_text ?? '-'}</p>
                        <p className="text-xs text-slate-500">坐标 {p.lng}, {p.lat} · 难度 ★{p.difficulty}</p>
                      </div>
                      <div className="flex flex-col gap-1.5 shrink-0 text-xs">
                        <button onClick={() => openPoiForm(p)} className="px-2.5 py-1 rounded-md bg-cyan-600/20 text-cyan-300 hover:bg-cyan-600/30 border border-cyan-600/40">编辑</button>
                        <a href={`https://ditu.amap.com/?q=${p.lat},${p.lng}`} target="_blank" rel="noopener noreferrer"
                          className="px-2.5 py-1 rounded-md bg-slate-700 hover:bg-slate-600 text-center">高德拾取</a>
                        <button onClick={() => deletePoi(p)} className="px-2.5 py-1 rounded-md bg-rose-600/20 text-rose-300 hover:bg-rose-600/30 border border-rose-600/40">删除</button>
                      </div>
                    </div>
                  </div>
                ))}
                {pois.length === 0 && <p className="text-slate-500 text-sm text-center py-6">暂无 POI，点击下方新增</p>}
              </div>
            )}
            <button onClick={() => openPoiForm()} className="mt-3 w-full py-2 rounded-lg border border-dashed border-slate-600 text-slate-400 hover:text-cyan-300 hover:border-cyan-500 text-sm">
              + 新增新闻点
            </button>
          </div>
        </div>
      )}

      {/* 纠错反馈弹窗 */}
      {showCorrections && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setShowCorrections(false)}>
          <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold">📨 新闻事件用户反馈</h3>
              <button onClick={() => setShowCorrections(false)} className="text-slate-400 hover:text-white text-lg px-2">×</button>
            </div>
            {corrLoading ? (
              <p className="text-slate-400 text-sm py-6 text-center">加载中...</p>
            ) : corrections.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-6">暂无反馈</p>
            ) : (
              <div className="space-y-2">
                {corrections.map((c) => (
                  <div key={c.id} className="bg-slate-900/60 rounded-xl border border-slate-700 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] border ${
                            c.status === 'handled'
                              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                              : 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                          }`}>
                            {c.status === 'handled' ? '已处理' : '待处理'}
                          </span>
                          <span className="text-xs text-slate-400 truncate">{c.poi_name_full ? `${c.poi_name_full} · ` : ''}{c.poi_name}</span>
                        </div>
                        <p className="text-sm text-slate-200 mt-1.5 whitespace-pre-wrap">{c.content}</p>
                        <p className="text-[10px] text-slate-500 mt-1">
                          {c.nickname ? `用户：${c.nickname} · ` : ''}{c.contact ? `联系：${c.contact} · ` : ''}{c.created_at?.slice(0, 16).replace('T', ' ')}
                        </p>
                      </div>
                      {c.status === 'pending' && (
                        <button
                          onClick={() => handleCorrection(c.id)}
                          className="shrink-0 text-xs px-2.5 py-1 rounded-md bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 border border-emerald-600/40"
                        >
                          标记已处理
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* POI 表单弹窗 */}
      {poiForm && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={() => setPoiForm(null)}>
          <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-base">{poiEditingId ? '编辑新闻点' : '新增新闻点'}</h3>
            <div className="grid grid-cols-4 gap-3">
              <label className="col-span-3 text-xs text-slate-400 space-y-1">名称 *
                <input value={poiForm.name} onChange={(e) => setPoiForm({ ...poiForm, name: e.target.value })}
                  className="w-full mt-0.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm" />
              </label>
              <label className="text-xs text-slate-400 space-y-1">事件日期
                <input value={poiForm.event_date ?? ''} onChange={(e) => setPoiForm({ ...poiForm, event_date: e.target.value })}
                  className="w-full mt-0.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm" placeholder="2026-10-01" />
              </label>
            </div>
            <label className="block text-xs text-slate-400 space-y-1">事件简介（找齐解锁）
              <textarea value={poiForm.event_text ?? ''} rows={2} onChange={(e) => setPoiForm({ ...poiForm, event_text: e.target.value })}
                className="w-full mt-0.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm" />
            </label>
            <label className="block text-xs text-slate-400 space-y-1">地理冷知识（找齐解锁）
              <textarea value={poiForm.fact_text ?? ''} rows={2} onChange={(e) => setPoiForm({ ...poiForm, fact_text: e.target.value })}
                className="w-full mt-0.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm" />
            </label>
            <label className="block text-xs text-slate-400 space-y-1">提示文案（不剧透）
              <textarea value={poiForm.hint_text ?? ''} rows={2} onChange={(e) => setPoiForm({ ...poiForm, hint_text: e.target.value })}
                className="w-full mt-0.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm" />
            </label>
            <div className="text-xs text-slate-400 space-y-1">坐标拾取（拖拽水滴 / 点击地图 / 搜索地名）
              <CoordPickerMap
                lng={poiForm.lng}
                lat={poiForm.lat}
                onChange={(lng, lat) => setPoiForm({ ...poiForm, lng, lat })}
              />
            </div>
            <div className="grid grid-cols-5 gap-3">
              <label className="text-xs text-slate-400 space-y-1">经度 lng
                <input type="number" step="0.000001" value={poiForm.lng} onChange={(e) => setPoiForm({ ...poiForm, lng: Number(e.target.value) })}
                  className="w-full mt-0.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm" />
              </label>
              <label className="text-xs text-slate-400 space-y-1">纬度 lat
                <input type="number" step="0.000001" value={poiForm.lat} onChange={(e) => setPoiForm({ ...poiForm, lat: Number(e.target.value) })}
                  className="w-full mt-0.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm" />
              </label>
              <label className="text-xs text-slate-400 space-y-1">难度 ★
                <input type="number" min={1} max={5} value={poiForm.difficulty} onChange={(e) => setPoiForm({ ...poiForm, difficulty: Number(e.target.value) })}
                  className="w-full mt-0.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm" />
              </label>
              <label className="text-xs text-slate-400 space-y-1">序号
                <input type="number" value={poiForm.sort_order} onChange={(e) => setPoiForm({ ...poiForm, sort_order: Number(e.target.value) })}
                  className="w-full mt-0.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm" />
              </label>
              <label className="text-xs text-slate-400 space-y-1">地区
                <input value={poiForm.region ?? ''} onChange={(e) => setPoiForm({ ...poiForm, region: e.target.value })}
                  className="w-full mt-0.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm" placeholder="浙江省嘉兴市" />
              </label>
            </div>
            <div className="text-xs text-slate-400 space-y-1">实景图（新闻卡片配图）
              <CoverUploadField
                value={poiForm.cover_url ?? ''}
                onChange={(v) => setPoiForm({ ...poiForm, cover_url: v })}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <label className="text-xs text-slate-400 space-y-1">报道链接（P2）
                <input value={poiForm.link_url ?? ''} onChange={(e) => setPoiForm({ ...poiForm, link_url: e.target.value })}
                  className="w-full mt-0.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm" />
              </label>
              <label className="text-xs text-slate-400 space-y-1">媒体来源
                <input value={poiForm.link_source ?? ''} onChange={(e) => setPoiForm({ ...poiForm, link_source: e.target.value })}
                  className="w-full mt-0.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm" placeholder="新华网" />
              </label>
              <label className="text-xs text-slate-400 space-y-1">状态
                <select value={poiForm.status} onChange={(e) => setPoiForm({ ...poiForm, status: e.target.value as NewsPoiInput['status'] })}
                  className="w-full mt-0.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm">
                  <option value="pending">待核定</option>
                  <option value="approved">已核定</option>
                  <option value="rejected">已驳回</option>
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={poiForm.verified} onChange={(e) => setPoiForm({ ...poiForm, verified: e.target.checked })} />
              坐标已人工核定（高德逆地理核实）
            </label>
            {poiError && <p className="text-rose-400 text-xs">{poiError}</p>}
            <div className="flex gap-2 pt-1">
              <button onClick={savePoi} disabled={poiSaving} className="flex-1 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-lg text-sm font-bold">
                {poiSaving ? '保存中...' : '保存'}
              </button>
              <button onClick={() => setPoiForm(null)} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm">取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
