import { lazy, StrictMode, Suspense, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, Navigate, Outlet, RouterProvider, type RouteObject } from 'react-router-dom'
import { Toaster } from 'sonner'
import './index.css'
import './additions.css'
import './styles/client-pages.css'
import './styles/billing.css'
import './styles/business.css'
import { queryClient } from './lib/query'
import { features } from './lib/env'
import { RedirectIfAuthed, RequireAdmin, RequireAuth } from './auth/AuthProvider'
import { ConfirmProvider } from './components/Modal'
import { PageSkeleton } from './components/ui'
import AppLayout from './layout/AppLayout'
import AdminLayout from './layout/AdminLayout'
import RouteError from './pages/RouteError'

// Each page is its own chunk, downloaded the first time it is opened. The layouts show a
// skeleton (<Suspense> in Root and AppLayout) while a page's code loads.
const page = <T extends { default: ComponentType }>(load: () => Promise<T>) => lazy(load)
const Login = page(() => import('./pages/auth/Login'))
const Signup = page(() => import('./pages/auth/Signup'))
const ForgotPassword = page(() => import('./pages/auth/Passwords').then((m) => ({ default: m.ForgotPassword })))
const ResetPassword = page(() => import('./pages/auth/Passwords').then((m) => ({ default: m.ResetPassword })))
const Dashboard = page(() => import('./pages/Dashboard'))
const PhotoSelection = page(() => import('./pages/PhotoSelection'))
const DigitalAlbum = page(() => import('./pages/DigitalAlbum'))
const FaceRecognition = page(() => import('./pages/FaceRecognition'))
const AllSubscription = page(() => import('./pages/AllSubscription'))
const MySubscription = page(() => import('./pages/MySubscription'))
const AllAccess = page(() => import('./pages/AllAccess'))
const ReferAndEarn = page(() => import('./pages/ReferAndEarn'))
const WhatsAppCredit = page(() => import('./pages/WhatsAppCredit'))
const Billing = page(() => import('./pages/Billing'))
const MyWebsite = page(() => import('./pages/MyWebsite'))
const GalleryBanner = page(() => import('./pages/GalleryBanner'))
const MyProfile = page(() => import('./pages/MyProfile'))
const HelpCenter = page(() => import('./pages/HelpCenter'))
const SupportTickets = page(() => import('./pages/SupportTickets'))
const Logout = page(() => import('./pages/Logout'))
const NotFound = page(() => import('./pages/NotFound'))
const PublicSelection = page(() => import('./pages/public/PublicSelection'))
const PublicAlbum = page(() => import('./pages/public/PublicAlbum'))
const InvoicePrint = page(() => import('./pages/InvoicePrint'))
const PublicSite = page(() => import('./pages/public/PublicSite'))
const AdminTickets = page(() => import('./pages/admin/AdminTickets'))
const AdminFaqs = page(() => import('./pages/admin/AdminFaqs'))
const AdminPlans = page(() => import('./pages/admin/AdminPlans'))

// Root element: things every route needs (confirm dialogs use the router for "leave page?" prompts).
function Root() {
  return (
    <ConfirmProvider>
      <Suspense fallback={<PageSkeleton />}>
        <Outlet />
      </Suspense>
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
    // Friendly crash screen; React Router's default one shows the stack trace even in production.
    errorElement: <RouteError />,
    children: [
      // Login handles an existing session itself (shows who is logged in, offers to switch account).
      { path: '/login', element: <Login /> },
      { path: '/signup', element: <RedirectIfAuthed><Signup /></RedirectIfAuthed> },
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
      // Platform admin area: SUPER_ADMIN only (checked here and again by the API on every request).
      {
        path: '/admin',
        element: (
          <RequireAdmin>
            <AdminLayout />
          </RequireAdmin>
        ),
        children: [
          { index: true, element: <Navigate to="/admin/tickets" replace /> },
          { path: 'tickets', element: <AdminTickets /> },
          { path: 'help', element: <AdminFaqs /> },
          { path: 'plans', element: <AdminPlans /> },
          { path: 'logout', element: <Logout /> },
          { path: '*', element: <NotFound /> },
        ],
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
