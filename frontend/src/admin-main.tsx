import React from 'react'
import ReactDOM from 'react-dom/client'
import AdminApp from './pages/admin/AdminApp'
import 'leaflet/dist/leaflet.css'
import './index.css'

// 独立后台入口：退出时跳回前台游戏站
function App() {
  const handleExit = () => {
    window.location.href = 'https://word.zhizhang.me/'
  }
  return <AdminApp onExit={handleExit} />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
