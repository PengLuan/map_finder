import { useState, useEffect, useCallback } from 'react'
import { adminApi } from '../../api/admin'
import type { SubmissionList, SubmissionItem, ApproveInput, AdminPOI, AdminPOIInput, AdminTheme } from '../../types/admin'
import POIEditor from '../../components/admin/POIEditor'

interface Props {
  onAuthError: () => void
}

type Tab = 'pending' | 'approved' | 'rejected'

const TABS: { key: Tab; name: string }[] = [
  { key: 'pending', name: '待审核' },
  { key: 'approved', name: '已通过' },
  { key: 'rejected', name: '已驳回' },
]

// 把投稿转换为伪 AdminPOI 以复用 POIEditor
function submissionToPoi(sub: SubmissionItem): AdminPOI {
  const shape = (sub.suggested_shape_type === 'circle' || sub.suggested_shape_type === 'polygon'
    ? sub.suggested_shape_type
    : 'point') as AdminPOI['shape_type']
  return {
    id: 0,
    name: sub.name,
    category: sub.category,
    lng: sub.lng,
    lat: sub.lat,
    adcode: sub.province_code,
    address: null,
    summary: sub.description,
    cover_url: sub.cover_url,
    hint_text: null,
    difficulty: 3,
    source: 'contribution',
    used_count: 0,
    verify_status: 'pending',
    contributor_nickname: sub.nickname,
    shape_type: shape,
    radius_km: sub.suggested_radius_km || 1,
    area_review: 0,
    area_geojson: sub.suggested_area_geojson,
    collections: [],
  }
}

export default function Submissions({ onAuthError }: Props) {
  const [tab, setTab] = useState<Tab>('pending')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<SubmissionList | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [rejecting, setRejecting] = useState<SubmissionItem | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [editingSub, setEditingSub] = useState<SubmissionItem | null>(null)
  const [themes, setThemes] = useState<AdminTheme[]>([])
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const [toast, setToast] = useState('')

  // 加载主题（编辑用）
  useEffect(() => {
    adminApi.listThemes(true).then(setThemes).catch(() => {})
  }, [])

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    adminApi
      .listSubmissions(tab, page, 20)
      .then(setData)
      .catch((e: Error) => {
        if (e.message.includes('未登录')) {
          onAuthError()
          return
        }
        setError(e.message)
      })
      .finally(() => setLoading(false))
  }, [tab, page, onAuthError])

  useEffect(() => {
    load()
  }, [load])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const handleApproveDefault = (sub: SubmissionItem) => {
    setActionLoading(sub.id)
    adminApi
      .approveSubmission(sub.id, {})
      .then((res) => {
        showToast(`已入库 POI #${res.poi_id}`)
        load()
      })
      .catch((e: Error) => {
        if (e.message.includes('未登录')) {
          onAuthError()
          return
        }
        setError(e.message)
      })
      .finally(() => setActionLoading(null))
  }

  const handleApproveWithEdit = (input: AdminPOIInput) => {
    if (!editingSub) return
    const approveData: ApproveInput = {
      name: input.name,
      category: input.category,
      lng: input.lng,
      lat: input.lat,
      adcode: input.adcode,
      summary: input.summary,
      cover_url: input.cover_url,
      difficulty: input.difficulty,
      shape_type: input.shape_type,
      radius_km: input.radius_km,
      area_geojson: input.area_geojson,
      contributor_nickname: input.contributor_nickname,
    }
    setActionLoading(editingSub.id)
    adminApi
      .approveSubmission(editingSub.id, approveData)
      .then((res) => {
        showToast(`已入库 POI #${res.poi_id}`)
        setEditingSub(null)
        load()
      })
      .catch((e: Error) => {
        if (e.message.includes('未登录')) {
          onAuthError()
          return
        }
        setError(e.message)
      })
      .finally(() => setActionLoading(null))
  }

  const handleReject = () => {
    if (!rejecting) return
    setActionLoading(rejecting.id)
    adminApi
      .rejectSubmission(rejecting.id, rejectNote || '未提供原因')
      .then(() => {
        setRejecting(null)
        setRejectNote('')
        showToast('已驳回')
        load()
      })
      .catch((e: Error) => {
        if (e.message.includes('未登录')) {
          onAuthError()
          return
        }
        setError(e.message)
      })
      .finally(() => setActionLoading(null))
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-100">投稿审核</h2>
        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-sm rounded-lg">
          {loading ? '刷新中…' : '↻ 刷新'}
        </button>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 bg-slate-800/60 border border-slate-700 rounded-lg p-1 w-fit">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => { setTab(t.key); setPage(1) }}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              tab === t.key ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}>
            {t.name}
          </button>
        ))}
      </div>

      {toast && (
        <div className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">{toast}</div>
      )}
      {error && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>
      )}

      {/* 列表 */}
      <div className="space-y-3">
        {loading && <div className="text-slate-400 py-8 text-center">加载中…</div>}
        {!loading && data && data.items.length === 0 && (
          <div className="text-slate-500 py-8 text-center bg-slate-800/40 rounded-xl">暂无数据</div>
        )}
        {!loading && data && data.items.map((sub) => (
          <div key={sub.id} className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
            <div className="p-4 flex gap-4">
              {/* 封面缩略图 */}
              <div className="w-24 h-24 shrink-0 rounded-lg overflow-hidden bg-slate-900 border border-slate-700">
                {sub.cover_url ? (
                  <img src={sub.cover_url} alt={sub.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-600 text-xs">无图</div>
                )}
              </div>

              {/* 主要信息 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-slate-100 font-semibold">{sub.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5">#{sub.id} · 提交者：{sub.nickname ?? '匿名'}</div>
                  </div>
                  <div className="text-xs text-slate-500">{sub.submitted_at ?? '-'}</div>
                </div>
                <div className="text-xs text-slate-400 mt-1 font-mono">
                  {sub.lng.toFixed(4)}, {sub.lat.toFixed(4)}
                  {sub.province_code ? ` · ${sub.province_code}` : ''}
                </div>
                <div className="text-sm text-slate-300 mt-2 line-clamp-2">
                  {sub.description ?? '（无描述）'}
                </div>
                <div className="flex flex-wrap gap-2 mt-2 text-xs">
                  <span className="px-2 py-0.5 bg-slate-700/60 text-slate-300 rounded">建议形态：{sub.suggested_shape_type}</span>
                  {sub.suggested_shape_type === 'circle' && (
                    <span className="px-2 py-0.5 bg-slate-700/60 text-slate-300 rounded">半径 {sub.suggested_radius_km}km</span>
                  )}
                  {sub.category && (
                    <span className="px-2 py-0.5 bg-slate-700/60 text-slate-300 rounded">分类：{sub.category}</span>
                  )}
                  {sub.status !== 'pending' && (
                    <span className={`px-2 py-0.5 rounded ${
                      sub.status === 'approved' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                    }`}>
                      {sub.status === 'approved' ? '已通过' : '已驳回'}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* 展开详情 */}
            {expanded === sub.id && (
              <div className="px-4 pb-3 border-t border-slate-700/50 pt-3 space-y-2">
                <div className="text-xs text-slate-400">会话 ID：{sub.session_id}</div>
                {sub.suggested_area_geojson && (
                  <div className="text-xs text-slate-400 break-all">
                    <span className="text-slate-500">区域 GeoJSON：</span>{sub.suggested_area_geojson.slice(0, 200)}…
                  </div>
                )}
                {sub.reviewer_note && (
                  <div className="text-xs text-slate-400">审核备注：{sub.reviewer_note}</div>
                )}
                {sub.reviewed_at && (
                  <div className="text-xs text-slate-400">审核时间：{sub.reviewed_at}</div>
                )}
              </div>
            )}

            {/* 操作栏 */}
            <div className="px-4 py-2 border-t border-slate-700/50 flex items-center justify-between bg-slate-800/40">
              <button onClick={() => setExpanded(expanded === sub.id ? null : sub.id)}
                className="text-xs text-cyan-400 hover:text-cyan-300">
                {expanded === sub.id ? '收起' : '详情'}
              </button>
              {sub.status === 'pending' && (
                <div className="flex gap-2">
                  <button onClick={() => handleApproveDefault(sub)} disabled={actionLoading === sub.id}
                    className="text-xs px-3 py-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded">直接通过</button>
                  <button onClick={() => setEditingSub(sub)} disabled={actionLoading === sub.id}
                    className="text-xs px-3 py-1 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded">修改后通过</button>
                  <button onClick={() => { setRejecting(sub); setRejectNote('') }} disabled={actionLoading === sub.id}
                    className="text-xs px-3 py-1 bg-red-600/80 hover:bg-red-500 disabled:opacity-50 text-white rounded">驳回</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 分页 */}
      {data && data.total > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">
            共 {data.total} 条 · 第 {page}/{totalPages} 页
          </span>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 rounded-lg">
              上一页
            </button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 rounded-lg">
              下一页
            </button>
          </div>
        </div>
      )}

      {/* 驳回弹窗 */}
      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setRejecting(null)}>
          <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-100 mb-3">驳回投稿</h3>
            <p className="text-sm text-slate-300 mb-3">
              确定驳回「<span className="text-cyan-300">{rejecting.name}</span>」吗？请填写驳回原因。
            </p>
            <textarea value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              rows={3}
              className="input"
              placeholder="驳回原因（可选）" />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setRejecting(null)} disabled={actionLoading === rejecting.id}
                className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg">取消</button>
              <button onClick={handleReject} disabled={actionLoading === rejecting.id}
                className="px-4 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm rounded-lg">
                {actionLoading === rejecting.id ? '处理中…' : '确认驳回'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 修改后通过：复用 POIEditor */}
      {editingSub && (
        <POIEditor
          poi={submissionToPoi(editingSub)}
          themes={themes}
          onSave={handleApproveWithEdit}
          onCancel={() => setEditingSub(null)}
        />
      )}
    </div>
  )
}
