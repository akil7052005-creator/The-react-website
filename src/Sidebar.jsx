import React from 'react'

function Sidebar() {
  return (
    <div className='Minusone'>
      <div className='d-flex flex-column gap-4'>
        <div className='zero'><button className='a0'><i className="bi bi-house-door"></i>Dashboard</button></div>
        <div><button className='a1'><i className="bi bi-image"></i>Photo Selection</button></div>
        <div><button className='a2'><i className="bi bi-images"></i>Digital Album</button></div>
        <div><button className='a3'><i className="bi bi-emoji-smile"></i>Ai Face Recognice</button></div>
        <div><button className='a4'><i className="bi bi-box"></i>All Subscription</button></div>
        <div><button className='a5'><i className="bi bi-box2-heart"></i>My Subscription</button></div>
        <div><button className='a7'><i className="bi bi-star-fill"></i>All-Access</button></div>
        <div><button className='a8'><i className="bi bi-inboxes"></i>Refer & Earn / Wallet</button></div>
      </div>
      <div className='d-flex flex-column gap-4'>
        <div className='one'><button className='a9'><i className="bi bi-whatsapp"></i>WhatsApp </button></div>
        <div><button className='b0'><i className="bi bi-receipt"></i>Billing</button></div>
        <div><button className='b1'><i className="bi bi-browser-edge"></i>My Website</button></div>
        <div><button className='b2'><i className="bi bi-image-fill"></i>Gallery Banner</button></div>
      </div>
      <div className='d-flex flex-column gap-4'>
        <div className='two'><button className='b3'><i className="bi bi-person-square"></i>My Profile</button></div>
        <div><button className='b4'><i className="bi bi-question-circle"></i>Help Center</button></div>
        <div><button className='b5'><i className="bi bi-headset"></i>Support Tickets</button></div>
      </div>
      <div className='d-flex flex-column gap-4'>
        <div className='three'><button className='b6'><i className="bi bi-arrow-up-circle-fill"></i>Logout</button></div>
      </div>
    </div>
  )
}

export default Sidebar


// className='position-fixed bottom-0 d-flex