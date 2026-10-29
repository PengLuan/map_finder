/**
 * DevPlansModal — 开发计划公示 + 用户评价（第三期）
 * 计划卡片（三态徽标）+ 👍/👎 快评 + 文字反馈 + 附图（最多3张）
 * 评价全员可见；同设备一条，可修改覆盖、可撤回（后台存档）
 */
import { useState, useEffect, useCallback } from 'react'
import { api, getSessionId, type DevPlanItem, type DevPlanFeedbackItem } from '../api'
import { getStoredUser } from '../api/pk'

interface Props {
  onClose: () => void
}

const MAX_IMAGES = 3

const STATUS_BADGE: Record<string, { text: string; cls: string }> = {
  planning: { text: '计划中', cls: 'bg-cyan-500/20 text-cyan-300' },
  done: { text: '已上线', cls: 'bg-green-500/20 text-green-300' },
  abandoned: { text: '已放弃', cls: 'bg-slate-500/20 text-slate-400' },
}

export default function DevPlansModal({ onClose }: Props) {
  const [plans, setPlans] = useState<DevPlanItem[] | null>(null)
  const [error, setError] = useState('')
  // 评价表单（针对当前展开的计划）
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [attitude, setAttitude] = useState<'like' | 'dislike' | null>(null)
  const [comment, setComment] = useState('')
  const [nickname, setNickname] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [formMsg, setFormMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  // 评价列表
  const [feedbacks, setFeedbacks] = useState<DevPlanFeedbackItem[]>([])
  const [fbTotal, setFbTotal] = useState(0)
  const [fbPage, setFbPage] = useState(1)
  const [fbLoading, setFbLoading] = useState(false)
  // 图片预览
  const [preview, setPreview] = useState<string | null>(null)

  const sessionId = getSessionId()

  const loadPlans = useCallback(async () => {
    try {
      const res = await api.getDevPlans(sessionId)
      setPlans(res.items)
    } catch (e: any) {
      setError(e.message || '加载失败')
      setPlans([])
    }
  }, [sessionId])

  useEffect(() => { loadPlans() }, [loadPlans])

  const loadFeedbacks = useCallback(async (planId: number, page: number, append = false) => {
    setFbLoading(true)
    try {
      const res = await api.getDevPlanFeedbacks(planId, page)
      setFeedbacks((prev) => (append ? [...prev, ...res.items] : res.items))
      setFbTotal(res.total)
      setFbPage(page)
    } catch {
      if (!append) { setFeedbacks([]); setFbTotal(0) }
    } finally {
      setFbLoading(false)
    }
  }, [])

  const toggleExpand = useCallback((plan: DevPlanItem) => {
    if (expandedId === plan.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(plan.id)
    setFormMsg(null)
    // 预填本人评价（若有）
    setAttitude(plan.my_attitude)
    setComment('')
    setImages([])
    setNickname(getStoredUser()?.nickname || '')
    setFeedbacks([])
    setFbTotal(0)
    loadFeedbacks(plan.id, 1)
  }, [expandedId, loadFeedbacks])

  const handleUpload = useCallback(async (file: File) => {
    if (images.length >= MAX_IMAGES) return
    setUploading(true)
    setUploadPct(0)
    setFormMsg(null)
    try {
      const { url } = await api.uploadCover(file, (pct) => setUploadPct(pct))
      setImages((prev) => [...prev, url])
    } catch (e: any) {
      setFormMsg({ type: 'err', text: e.message || '图片上传失败' })
    } finally {
      setUploading(false)
      setUploadPct(0)
    }
  }, [images.length])

  const handleSubmit = useCallback(async (planId: number) => {
    if (!attitude) {
      setFormMsg({ type: 'err', text: '请先选择 👍 或 👎' })
      return
    }
    setSubmitting(true)
    setFormMsg(null)
    try {
      const res = await api.submitDevPlanFeedback(planId, {
        session_id: sessionId,
        attitude,
        comment: comment.trim() || undefined,
        images: images.length ? images : undefined,
        nickname: nickname.trim() || getStoredUser()?.nickname || undefined,
      })
      setPlans((prev) => prev?.map((p) => p.id === planId
        ? { ...p, like_count: res.like_count, dislike_count: res.dislike_count, my_attitude: attitude }
        : p) ?? null)
      setFormMsg({ type: 'ok', text: '评价成功！感谢反馈' })
      loadFeedbacks(planId, 1)
    } catch (e: any) {
      setFormMsg({ type: 'err', text: e.message || '提交失败' })
    } finally {
      setSubmitting(false)
    }
  }, [attitude, comment, images, nickname, sessionId, loadFeedbacks])

  const handleWithdraw = useCallback(async (plan: DevPlanItem) => {
    try {
      const res = await api.withdrawDevPlanFeedback(plan.id, sessionId)
      setPlans((prev) => prev?.map((p) => p.id === plan.id
        ? { ...p, like_count: res.like_count, dislike_count: res.dislike_count, my_attitude: null }
        : p) ?? null)
      setAttitude(null)
      setFormMsg({ type: 'ok', text: '已撤回评价' })
      loadFeedbacks(plan.id, 1)
    } catch (e: any) {
      setFormMsg({ type: 'err', text: e.message || '撤回失败' })
    }
  }, [sessionId, loadFeedbacks])

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* 标题栏 */}
        <div className="sticky top-0 bg-slate-800 flex items-center justify-between px-5 py-4 border-b border-slate-700 rounded-t-2xl">
          <h2 className="text-sm font-bold text-slate-100">🗺️ 开发计划</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="p-4 space-y-3">
          {error && <div className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}
          {plans === null ? (
            <div className="text-center text-xs text-slate-500 py-8">加载中…</div>
          ) : plans.length === 0 ? (
            <div className="text-center text-xs text-slate-500 py-8">暂无开发计划，敬请期待</div>
          ) : (
            plans.map((plan) => {
              const badge = STATUS_BADGE[plan.status] ?? STATUS_BADGE.planning
              const expanded = expandedId === plan.id
              return (
                <div key={plan.id} className="bg-slate-900/60 border border-slate-700/60 rounded-xl p-3.5">
                  {/* 标题行 */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-bold text-slate-100 truncate">{plan.title}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${badge.cls}`}>{badge.text}</span>
                    </div>
                    <span className="text-[10px] text-slate-500 flex-shrink-0">{plan.created_at}</span>
                  </div>

                  {/* 内容（折叠时最多3行） */}
                  <p className={`text-xs text-slate-300 leading-relaxed mt-1.5 whitespace-pre-wrap break-words ${expanded ? '' : 'line-clamp-3'}`}>
                    {plan.content}
                  </p>

                  {/* 计数 + 展开 */}
                  <div className="flex items-center gap-3 mt-2.5">
                    <span className="text-xs text-slate-400">👍 {plan.like_count}</span>
                    <span className="text-xs text-slate-400">👎 {plan.dislike_count}</span>
                    <button
                      onClick={() => toggleExpand(plan)}
                      className="ml-auto text-xs text-cyan-400 hover:text-cyan-300"
                    >
                      {expanded ? '收起 ▲' : (plan.feedback_total ?? 0) > 0 ? `评价 ${plan.feedback_total} · 展开 ▼` : '写评价 · 展开 ▼'}
                    </button>
                  </div>

                  {/* 展开区：评价表单 + 评价列表 */}
                  {expanded && (
                    <div className="mt-3 pt-3 border-t border-slate-700/60 space-y-3">
                      {/* 快评态度 */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">这个计划你觉得：</span>
                        <button
                          onClick={() => setAttitude('like')}
                          className={`px-3 py-1 rounded-lg text-xs border transition-colors ${
                            attitude === 'like'
                              ? 'bg-green-500/20 border-green-400 text-green-300'
                              : 'border-slate-600 text-slate-400 hover:border-green-400/60'
                          }`}
                        >
                          👍 期待
                        </button>
                        <button
                          onClick={() => setAttitude('dislike')}
                          className={`px-3 py-1 rounded-lg text-xs border transition-colors ${
                            attitude === 'dislike'
                              ? 'bg-red-500/20 border-red-400 text-red-300'
                              : 'border-slate-600 text-slate-400 hover:border-red-400/60'
                          }`}
                        >
                          👎 一般
                        </button>
                        {plan.my_attitude && (
                          <button
                            onClick={() => handleWithdraw(plan)}
                            className="ml-auto text-[10px] text-slate-500 hover:text-red-400 underline"
                          >
                            撤回我的评价
                          </button>
                        )}
                      </div>

                      {/* 文字反馈 */}
                      <textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        rows={2}
                        maxLength={256}
                        placeholder="说说你的想法（可选）"
                        className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 resize-none"
                      />
                      <div className="text-right text-[10px] text-slate-500 -mt-2">{comment.length}/256</div>

                      {/* 附图 */}
                      <div className="flex flex-wrap gap-2">
                        {images.map((url, i) => (
                          <div key={i} className="relative w-14 h-14 rounded-lg overflow-hidden border border-slate-700">
                            <img src={url} alt="" className="w-full h-full object-cover" />
                            <button
                              onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                              className="absolute top-0 right-0 bg-red-500/80 text-white text-xs w-4.5 h-4.5 flex items-center justify-center rounded-bl-lg hover:bg-red-400"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        {images.length < MAX_IMAGES && (
                          <label className={`w-14 h-14 flex items-center justify-center rounded-lg border border-dashed border-slate-600 cursor-pointer hover:border-cyan-500 transition-colors ${uploading ? 'opacity-50' : ''}`}>
                            {uploading ? (
                              <span className="text-[10px] text-cyan-400 font-medium">{uploadPct}%</span>
                            ) : (
                              <span className="text-xl text-slate-500">+</span>
                            )}
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              className="hidden"
                              disabled={uploading}
                              onChange={(e) => {
                                const f = e.target.files?.[0]
                                if (f) handleUpload(f)
                                e.target.value = ''
                              }}
                            />
                          </label>
                        )}
                      </div>

                      {/* 称呼 */}
                      <input
                        type="text"
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        maxLength={30}
                        placeholder="称呼（可选，默认展示为「路人」）"
                        className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                      />

                      {formMsg && (
                        <div className={`text-xs rounded-lg px-3 py-2 ${
                          formMsg.type === 'ok' ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'
                        }`}>
                          {formMsg.text}
                        </div>
                      )}

                      <button
                        onClick={() => handleSubmit(plan.id)}
                        disabled={submitting || !attitude}
                        className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold transition-colors"
                      >
                        {submitting ? '提交中…' : plan.my_attitude ? '更新评价' : '提交评价'}
                      </button>

                      {/* 评价列表（全员可见） */}
                      <div className="pt-1">
                        <div className="text-[10px] text-slate-500 mb-1.5">全部评价（{fbTotal}）</div>
                        {fbLoading && feedbacks.length === 0 ? (
                          <div className="text-center text-xs text-slate-500 py-3">加载中…</div>
                        ) : feedbacks.length === 0 ? (
                          <div className="text-center text-xs text-slate-500 py-3">还没有评价，来抢沙发</div>
                        ) : (
                          <div className="space-y-2">
                            {feedbacks.map((fb) => (
                              <div key={fb.id} className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-2.5">
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <span className="text-xs text-slate-300 font-medium truncate">
                                    {fb.nickname || '路人'}
                                  </span>
                                  <span className="text-[10px] flex-shrink-0">
                                    {fb.attitude === 'like' ? '👍' : '👎'} · {fb.created_at}
                                  </span>
                                </div>
                                {fb.comment && (
                                  <div className="text-xs text-slate-400 whitespace-pre-wrap break-words">{fb.comment}</div>
                                )}
                                {fb.images.length > 0 && (
                                  <div className="flex gap-1 mt-1.5">
                                    {fb.images.map((url, i) => (
                                      <img
                                        key={i}
                                        src={url}
                                        alt=""
                                        onClick={() => setPreview(url)}
                                        className="w-10 h-10 object-cover rounded border border-slate-700 cursor-pointer hover:opacity-80"
                                      />
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                            {feedbacks.length < fbTotal && (
                              <button
                                onClick={() => loadFeedbacks(plan.id, fbPage + 1, true)}
                                disabled={fbLoading}
                                className="w-full text-[10px] text-slate-500 hover:text-cyan-400 py-1"
                              >
                                {fbLoading ? '加载中…' : '加载更多'}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* 图片放大预览 */}
      {preview && (
        <div className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/80 p-8" onClick={() => setPreview(null)}>
          <img src={preview} alt="" className="max-w-full max-h-full rounded-lg" />
        </div>
      )}
    </div>
  )
}
