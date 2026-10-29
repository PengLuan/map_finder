import { useState, useCallback } from 'react'
import { getAdminToken, clearAdminToken } from '../../api/admin'
import Login from './Login'
import Overview from './Overview'
import Sessions from './Sessions'
import Themes from './Themes'
import POIManager from './POIManager'
import Submissions from './Submissions'
import Corrections from './Corrections'
import DevPlans from './DevPlans'
import Feedback from './Feedback'
import CollectionManager from './CollectionManager'
import UserManager from './UserManager'
import NewsManager from './NewsManager'

interface Props {
  onExit: () => void
}

type Tab = 'overview' | 'sessions' | 'poi' | 'themes' | 'collections' | 'news' | 'users' | 'submissions' | 'corrections' | 'devplans' | 'feedback'

const TABS: { key: Tab; name: string; icon: string }[] = [
  { key: 'overview', name: '概览', icon: '📊' },
  { key: 'sessions', name: '玩家会话', icon: '🎮' },
  { key: 'poi', name: 'POI管理', icon: '📍' },
  { key: 'themes', name: '主题管理', icon: '🎯' },
  { key: 'collections', name: '专题管理', icon: '🗺️' },
  { key: 'news', name: '新闻时间线', icon: '📰' },
  { key: 'users', name: '用户管理', icon: '👤' },
  { key: 'submissions', name: '投稿审核', icon: '📝' },
  { key: 'corrections', name: '纠正审核', icon: '✏️' },
  { key: 'devplans', name: '开发计划', icon: '🗺️' },
  { key: 'feedback', name: '意见留言', icon: '💬' },
]

export default function AdminApp({ onExit }: Props) {
  const [loggedIn, setLoggedIn] = useState<boolean>(() => !!getAdminToken())
  const [tab, setTab] = useState<Tab>('overview')

  const handleAuthError = useCallback(() => {
    clearAdminToken()
    setLoggedIn(false)
  }, [])

  const handleExit = useCallback(() => {
    onExit()
  }, [onExit])

  if (!loggedIn) {
    return <Login onSuccess={() => setLoggedIn(true)} />
  }

  return (
    <div className="h-screen w-screen flex bg-slate-900 text-slate-100 overflow-hidden">
      {/* 左侧导航 */}
      <aside className="w-56 shrink-0 bg-slate-950 border-r border-slate-800 flex flex-col">
        <div className="px-5 py-5 border-b border-slate-800">
          <h1 className="text-base font-bold text-slate-100 leading-tight">
            地图寻踪
          </h1>
          <p className="text-xs text-cyan-400 mt-1">后台管理</p>
        </div>
        <nav className="flex-1 py-3 space-y-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
                tab === t.key
                  ? 'bg-cyan-600/20 text-cyan-300 border-r-2 border-cyan-400'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <span className="text-lg">{t.icon}</span>
              <span>{t.name}</span>
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-slate-800">
          <button
            onClick={handleExit}
            className="w-full py-2 text-sm text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
          >
            ← 退出后台
          </button>
        </div>
      </aside>

      {/* 右侧内容区 */}
      <main className="flex-1 overflow-auto">
        {tab === 'overview' && <Overview onAuthError={handleAuthError} />}
        {tab === 'sessions' && <Sessions onAuthError={handleAuthError} />}
        {tab === 'poi' && <POIManager onAuthError={handleAuthError} />}
        {tab === 'themes' && <Themes onAuthError={handleAuthError} />}
        {tab === 'collections' && <CollectionManager onAuthError={handleAuthError} />}
        {tab === 'news' && <NewsManager onAuthError={handleAuthError} />}
        {tab === 'users' && <UserManager onAuthError={handleAuthError} />}
        {tab === 'submissions' && <Submissions onAuthError={handleAuthError} />}
        {tab === 'corrections' && <Corrections onAuthError={handleAuthError} />}
        {tab === 'devplans' && <DevPlans onAuthError={handleAuthError} />}
        {tab === 'feedback' && <Feedback onAuthError={handleAuthError} />}
      </main>
    </div>
  )
}
