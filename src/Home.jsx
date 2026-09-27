import React from 'react'
import Header from './Header'
import Sidebar from './Sidebar'
import Features from './Features'
import Dashboard from './content.jsx/Dashboard'

function Home() {
  return (
    <div className='page'>
          
          <div className='Header'>
            <Header/>
          </div>

          <div className='Features'>
            <Features/>
          </div>
        
          <div className='Sidebar'>
            <Sidebar/>
          </div>

          <div className='Dashboard'>
            <Dashboard/>
          </div>
       
      </div>


  )
}

export default Home