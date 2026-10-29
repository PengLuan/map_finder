import { useState, useCallback } from 'react'
import { api } from '../api'
import { getStoredUser } from '../api/pk'
import type { FeedbackHistoryItem } from '../api'

interface Props {
  onClose: () => void
}

const MAX_IMAGES = 3

export default function FeedbackModal({ onClose }: Props) {
  const [content, setContent] = useState('')
  const [nickname, setNickname] = useState('')
  const [contact, setContact] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  // 历史反馈与回复
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<FeedbackHistoryItem[] | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const res = await api.getMyFeedback()
      setHistory(res.items)
    } catch {
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  const toggleHistory = useCallback(() => {
    const next = !showHistory
    setShowHistory(next)
    if (next && history === null) loadHistory()
  }, [showHistory, history, loadHistory])

  const handleUpload = useCallback(async (file: File) => {
    if (images.length >= MAX_IMAGES) return
    setUploading(true)
    setUploadPct(0)
    setError('')
    try {
      const { url } = await api.uploadCover(file, (pct) => setUploadPct(pct))
      setImages((prev) => [...prev, url])
    } catch (e: any) {
      setError(e.message || '图片上传失败')
    } finally {
      setUploading(false)
      setUploadPct(0)
    }
  }, [images.length])

  const handleSubmit = useCallback(async () => {
    if (!content.trim()) {
      setError('请输入留言内容')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await api.submitFeedback({
        content: content.trim(),
        image_urls: images.length ? images : undefined,
        // 称呼回退：表单填写 > 已登录用户昵称 > 匿名
        nickname: nickname.trim() || getStoredUser()?.nickname || undefined,
        contact: contact.trim() || undefined,
      })
      setDone(true)
    } catch (e: any) {
      setError(e.message || '提交失败')
    } finally {
      setSubmitting(false)
    }
  }, [content, images, nickname, contact])

  if (done) {
    return (
      <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
        <div className="bg-slate-800 rounded-2xl p-6 max-w-sm w-[90%] text-center" onClick={(e) => e.stopPropagation()}>
          <div className="text-4xl mb-3">✅</div>
          <p className="text-slate-100 font-bold mb-1">感谢您的留言！</p>
          <p className="text-xs text-slate-400 mb-4">我们会认真阅读每一条反馈</p>
          <button onClick={onClose} className="px-6 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm font-medium transition-colors">
            关闭
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h2 className="text-sm font-bold text-slate-100">📝 意见留言</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          {/* 留言内容 */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">
              留言内容 <span className="text-red-400">*</span>
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              maxLength={500}
              placeholder="说说你的建议、吐槽或想法…"
              className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 resize-none"
            />
            <div className="text-right text-[10px] text-slate-500 mt-0.5">{content.length}/500</div>
          </div>

          {/* 图片上传 */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">
              附图（可选，最多{MAX_IMAGES}张）
            </label>
            <div className="flex flex-wrap gap-2">
              {images.map((url, i) => (
                <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-slate-700">
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                    className="absolute top-0 right-0 bg-red-500/80 text-white text-xs w-5 h-5 flex items-center justify-center rounded-bl-lg hover:bg-red-400"
                  >
                    ×
                  </button>
                </div>
              ))}
              {images.length < MAX_IMAGES && (
                <label className={`w-20 h-20 flex items-center justify-center rounded-lg border border-dashed border-slate-600 cursor-pointer hover:border-cyan-500 transition-colors ${uploading ? 'opacity-50' : ''}`}>
                  {uploading ? (
                    <span className="text-xs text-cyan-400 font-medium">{uploadPct}%</span>
                  ) : (
                    <span className="text-2xl text-slate-500">+</span>
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
          </div>

          {/* 称呼 */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">称呼（可选）</label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={30}
              placeholder="怎么称呼你？"
              className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* 联系方式 */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">联系方式（可选）</label>
            <input
              type="text"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              maxLength={50}
              placeholder="邮箱 / 微信 / QQ 等"
              className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</div>
          )}

          {/* 提交按钮 */}
          <button
            onClick={handleSubmit}
            disabled={submitting || !content.trim()}
            className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-bold transition-colors"
          >
            {submitting ? '提交中…' : '提交留言'}
          </button>

          {/* 历史反馈与回复 */}
          <div className="border-t border-slate-700 pt-3">
            <button
              onClick={toggleHistory}
              className="w-full flex items-center justify-between text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              <span>历史反馈与回复</span>
              <span>{showHistory ? '收起 ▲' : '展开 ▼'}</span>
            </button>
            {showHistory && (
              <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
                {historyLoading ? (
                  <div className="text-center text-xs text-slate-500 py-4">加载中…</div>
                ) : !history || history.length === 0 ? (
                  <div className="text-center text-xs text-slate-500 py-4">暂无历史反馈</div>
                ) : (
                  history.map((fb) => (
                    <div key={fb.id} className="bg-slate-900/60 border border-slate-700/60 rounded-lg p-2.5">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs text-slate-300 line-clamp-2 whitespace-pre-wrap break-words">{fb.content}</span>
                        <span className="text-[10px] text-slate-500 flex-shrink-0">{fb.created_at}</span>
                      </div>
                      {fb.image_urls.length > 0 && (
                        <div className="flex gap-1 mb-1">
                          {fb.image_urls.map((url, i) => (
                            <img key={i} src={url} alt="" className="w-8 h-8 object-cover rounded border border-slate-700" />
                          ))}
                        </div>
                      )}
                      {fb.admin_reply ? (
                        <div className="mt-1.5 bg-cyan-500/10 border border-cyan-500/30 rounded-lg px-2.5 py-1.5">
                          <div className="text-[10px] text-cyan-400 font-medium mb-0.5">官方回复 · {fb.replied_at}</div>
                          <div className="text-xs text-cyan-100 whitespace-pre-wrap break-words">{fb.admin_reply}</div>
                        </div>
                      ) : (
                        <div className="mt-1 text-[10px] text-slate-500">待回复</div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
