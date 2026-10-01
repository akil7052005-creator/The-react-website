import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import Topbar from '../components/Topbar'
import { GlobalDialogs } from '../components/GlobalDialogs'

function AppLayout() {
  // Controls the slide-in sidebar on phones/tablets.
  const [navOpen, setNavOpen] = useState(false)

  return (
    <div className={`app ${navOpen ? 'nav-open' : ''}`}>
      <Sidebar onNavigate={() => setNavOpen(false)} />
      <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />
      <div className="main">
        <Topbar onMenu={() => setNavOpen(true)} />
        <main className="content">
          <Outlet />
        </main>
      </div>
      <GlobalDialogs />
    </div>
  )
}

export default AppLayout
