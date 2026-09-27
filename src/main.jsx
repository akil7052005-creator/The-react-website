import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import Home from './Home.jsx'
import Dashboard from './content.jsx/Dashboard.jsx'
import PhotoSelection from './content.jsx/PhotoSelection.jsx'
import DigitalAlbum from './content.jsx/DigitalAlbum.jsx'
import AiFaceRecognice from './content.jsx/AiFaceRecognice.jsx'
import AllSubscription from './content.jsx/AllSubscription.jsx'
import MySubscription from './content.jsx/MySubscription.jsx'
import AllAccess from './content.jsx/AllAccess.jsx'
import ReferandEarn from './content.jsx/ReferandEarn.jsx'
import WhatsAppCredit from './content.jsx/WhatsAppCredit.jsx'
import Billing from './content.jsx/Billing.jsx'
import MyWebsite from './content.jsx/MyWebsite.jsx'
import GalleryBanner from './content.jsx/GalleryBanner.jsx'
import MyProfile from './content.jsx/MyProfile.jsx'
import HelpCenter from './content.jsx/HelpCenter.jsx'
import SupportTickets from './content.jsx/SupportTickets.jsx'
import Logout from './content.jsx/Logout.jsx'

const router = createBrowserRouter([
      {
        path:'/',
        element: <Home/>
      },
      {
        path:'/Dashboard',
        element: <Dashboard/>
      },
      {
        path:'/PhotoSelection',
        elementt: <PhotoSelection/>
      },
      {
        path:'/DigitalAlbum',
        elementt: <DigitalAlbum/> 
      },
      {
        path:'/AiFaceRecognice',
        elementt: <AiFaceRecognice/> 
      },
      {
        path:'/AllSubscription',
        elementt: <AllSubscription/> 
      },
      {
        path:'/MySubscription',
        elementt: <MySubscription/> 
      },
      {
        path:'/AllAccess',
        elementt: <AllAccess/> 
      },
      {
        path:'/ReferandEarn',
        elementt: <ReferandEarn/> 
      },
      {
        path:'/WhatsAppCredit',
        elementt: <WhatsAppCredit/> 
      },
      {
        path:'/Billing',
        elementt: <Billing/> 
      },
      {
        path:'/MyWebsite',
        elementt: <MyWebsite/> 
      },
      {
        path:'/GalleryBanner',
        elementt: <GalleryBanner/> 
      },
      {
        path:'/MyProfile',
        elementt: <MyProfile/> 
      },
      {
        path:'/HelpCenter',
        elementt: <HelpCenter/> 
      },
      {
        path:'/SupportTickets',
        elementt: <SupportTickets/> 
      },
      {
        path:'/Logout',
        elementt: <Logout/> 
      }
      
])

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
