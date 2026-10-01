import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, Outlet, RouterProvider, type RouteObject } from 'react-router-dom'
import { Toaster } from 'sonner'
import './index.css'
import './additions.css'
import './styles/client-pages.css'
import './styles/billing.css'
import './styles/business.css'
import { queryClient } from './lib/query'
import { features } from './lib/env'
import { RedirectIfAuthed, RequireAuth } from './auth/AuthProvider'
import { ConfirmProvider } from './components/Modal'
import AppLayout from './layout/AppLayout'
import Login from './pages/auth/Login'
import Signup from './pages/auth/Signup'
import { ForgotPassword, ResetPassword } from './pages/auth/Passwords'
import Dashboard from './pages/Dashboard'
import PhotoSelection from './pages/PhotoSelection'
import DigitalAlbum from './pages/DigitalAlbum'
import FaceRecognition from './pages/FaceRecognition'
import AllSubscription from './pages/AllSubscription'
import MySubscription from './pages/MySubscription'
import AllAccess from './pages/AllAccess'
import ReferAndEarn from './pages/ReferAndEarn'
import WhatsAppCredit from './pages/WhatsAppCredit'
import Billing from './pages/Billing'
import MyWebsite from './pages/MyWebsite'
import GalleryBanner from './pages/GalleryBanner'
import MyProfile from './pages/MyProfile'
import HelpCenter from './pages/HelpCenter'
import SupportTickets from './pages/SupportTickets'
import Logout from './pages/Logout'
import NotFound from './pages/NotFound'
import PublicSelection from './pages/public/PublicSelection'
import PublicAlbum from './pages/public/PublicAlbum'
import InvoicePrint from './pages/InvoicePrint'
import PublicSite from './pages/public/PublicSite'

// Root element: things every route needs (confirm dialogs use the router for "leave page?" prompts).
function Root() {
  return (
    <ConfirmProvider>
      <Outlet />
    </ConfirmProvider>
  )
}

const studioRoutes: RouteObject[] = [
  { index: true, element: <Dashboard /> },
  { path: 'photo-selection', element: <PhotoSelection /> },
  { path: 'digital-album', element: <DigitalAlbum /> },
  // AI Face Recognition is out of scope for v1 — kept in the code, hidden behind FEATURE_FACE_RECOGNITION.
  ...(features.faceRecognition ? [{ path: 'face-recognition', element: <FaceRecognition /> }] : []),
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
]

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: '/login', element: <RedirectIfAuthed><Login /></RedirectIfAuthed> },
      { path: '/signup', element: <RedirectIfAuthed to="/profile"><Signup /></RedirectIfAuthed> },
      { path: '/forgot-password', element: <ForgotPassword /> },
      { path: '/reset-password', element: <ResetPassword /> },
      // Client-facing pages: no login, access by unguessable token.
      { path: '/s/:token', element: <PublicSelection /> },
      { path: '/a/:token', element: <PublicAlbum /> },
      { path: '/w/:slug', element: <PublicSite /> },
      {
        path: '/invoices/:id/print',
        element: (
          <RequireAuth>
            <InvoicePrint />
          </RequireAuth>
        ),
      },
      {
        path: '/',
        element: (
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        ),
        children: studioRoutes,
      },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster position="top-right" closeButton richColors toastOptions={{ className: 'wz-toast' }} />
    </QueryClientProvider>
  </StrictMode>,
)
