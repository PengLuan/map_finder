/**
 * ProfileModal — 已登录用户资料弹窗：修改昵称 / 个性签名 / 公开主页开关 / 我的主页入口
 */
import { useState } from 'react'
import { authApi, setStoredUser, type CollectionUser } from '../api/collection'

interface Props {
  user: CollectionUser
  onClose: () => void
  onUpdated: (user: CollectionUser) => void
}

export default function ProfileModal({ user, onClose, onUpdated }: Props) {
  const [nickname, setNickname] = useState(user.nickname)
  const [slogan, setSlogan] = useState(user.slogan ?? '')
  const [profilePublic, setProfilePublic] = useState(user.profile_public !== false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])

  const handleSave = async () => {
    const trimmed = nickname.trim()
    if (!trimmed) {
      setError('请输入昵称')
      return
    }
    const settingsChanged =
      (slogan.trim() || '') !== (user.slogan ?? '') || profilePublic !== (user.profile_public !== false)
    if (trimmed === user.nickname && !settingsChanged) {
      onClose()
      return
    }
    setSaving(true)
    setError('')
    setSuggestions([])
    try {
      let updated: CollectionUser = user
      if (trimmed !== user.nickname) {
        updated = await authApi.updateNickname(trimmed)
      }
      if (settingsChanged) {
        const settings = await authApi.updateProfileSettings({
          slogan: slogan.trim(),
          profile_public: profilePublic,
        })
        updated = { ...updated, slogan: settings.slogan, profile_public: settings.profile_public }
      }
      setStoredUser(updated)
      onUpdated(updated)
      onClose()
    } catch (e: any) {
      const msg = e.message || '修改失败'
      setError(msg)
      if (msg.includes('占用')) {
        try {
          const res = await authApi.checkNickname(trimmed, trimmed)
          setSuggestions(res.suggestions || [])
        } catch {
          /* ignore */
        }
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[3000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-slate-800/95 rounded-2xl shadow-2xl border border-slate-700 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 text-center">
          <h2 className="text-xl font-bold text-cyan-300">我的资料</h2>
          <p className="text-xs text-slate-400 mt-1">{user.email}</p>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">昵称</label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => {
                setNickname(e.target.value)
                setError('')
                setSuggestions([])
              }}
              placeholder="2-16 个字符"
              maxLength={16}
              className="w-full px-4 py-2.5 bg-slate-900/60 border border-slate-600 rounded-xl text-white text-sm focus:border-cyan-400 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              个性签名 <span className="text-slate-500">（主页展示，{slogan.length}/100）</span>
            </label>
            <textarea
              value={slogan}
              onChange={(e) => setSlogan(e.target.value.slice(0, 100))}
              placeholder="写一句介绍自己的话（选填）"
              rows={2}
              maxLength={100}
              className="w-full px-4 py-2.5 bg-slate-900/60 border border-slate-600 rounded-xl text-white text-sm focus:border-cyan-400 outline-none resize-none"
            />
          </div>
          <button
            type="button"
            onClick={() => setProfilePublic((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-900/60 border border-slate-600 rounded-xl hover:border-slate-500 transition-colors"
          >
            <span className="text-left">
              <span className="block text-sm text-white">公开我的主页</span>
              <span className="block text-[11px] text-slate-500 mt-0.5">
                关闭后排行榜昵称不可点击，他人无法查看你的勋章与足迹
              </span>
            </span>
            <span
              className={`shrink-0 w-10 h-5 rounded-full relative transition-colors ${profilePublic ? 'bg-cyan-500' : 'bg-slate-600'}`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${profilePublic ? 'left-[22px]' : 'left-0.5'}`}
              />
            </span>
          </button>
          <button
            type="button"
            onClick={() => { window.location.hash = `#/user/${user.id}`; onClose() }}
            className="w-full py-2 text-xs text-cyan-300 hover:text-cyan-200"
          >
            👤 查看我的主页
          </button>
          {error && <p className="text-xs text-red-400">{error}</p>}
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setNickname(s)
                    setSuggestions([])
                    setError('')
                  }}
                  className="px-3 py-1 bg-slate-700 hover:bg-cyan-600/40 border border-slate-600 rounded-full text-xs text-cyan-200"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl text-sm font-bold text-white disabled:opacity-60"
          >
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            onClick={onClose}
            className="w-full py-2 text-xs text-slate-400 hover:text-cyan-300"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
