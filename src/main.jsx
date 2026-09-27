import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import AppLayout from './layout/AppLayout.jsx'
import Dashboard from './pages/Dashboard.jsx'
import PhotoSelection from './pages/PhotoSelection.jsx'
import DigitalAlbum from './pages/DigitalAlbum.jsx'
import FaceRecognition from './pages/FaceRecognition.jsx'
import AllSubscription from './pages/AllSubscription.jsx'
import MySubscription from './pages/MySubscription.jsx'
import AllAccess from './pages/AllAccess.jsx'
import ReferAndEarn from './pages/ReferAndEarn.jsx'
import WhatsAppCredit from './pages/WhatsAppCredit.jsx'
import Billing from './pages/Billing.jsx'
import MyWebsite from './pages/MyWebsite.jsx'
import GalleryBanner from './pages/GalleryBanner.jsx'
import MyProfile from './pages/MyProfile.jsx'
import HelpCenter from './pages/HelpCenter.jsx'
import SupportTickets from './pages/SupportTickets.jsx'
import Logout from './pages/Logout.jsx'
import NotFound from './pages/NotFound.jsx'

// AppLayout draws the sidebar + top bar once. Every child route renders
// inside its <Outlet />, so only the page content changes when you navigate.
const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'photo-selection', element: <PhotoSelection /> },
      { path: 'digital-album', element: <DigitalAlbum /> },
      { path: 'face-recognition', element: <FaceRecognition /> },
      { path: 'subscriptions', element: <AllSubscription /> },
      { path: 'my-subscription', element: <MySubscription /> },
      { path: 'all-access', element: <AllAccess /> },
      { path: 'refer-and-earn', element: <ReferAndEarn /> },
      { path: 'whatsapp-credit', element: <WhatsAppCredit /> },
      { path: 'billing', element: <Billing /> },
      { path: 'my-website', element: <MyWebsite /> },
      { path: 'gallery-banner', element: <GalleryBanner /> },
      { path: 'profile', element: <MyProfile /> },
      { path: 'help', element: <HelpCenter /> },
      { path: 'support', element: <SupportTickets /> },
      { path: 'logout', element: <Logout /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
