import React from 'react'

function Features() {
  return (
    <div className='d-flex '>

          <div><i className="head bi-list"></i></div>
          <div>
              <button className='search'><i className="bi bi-search"></i>search</button>
          </div>
          <div className='bell'><i className="bi bi-bell"></i></div>
          <div className='wallet'><i className="bi bi-archive"></i></div>
          <div className='chat'><i className="bi bi-chat"></i></div>
          <div className='question'><i className="bi bi-question-circle"></i></div>
          <div className='whatsapp'><i className="bi bi-whatsapp"></i></div>
          <div className='person'><i className="bi bi-person-circle"></i></div>
          <div className='arrow'><i className="bi bi-caret-down"></i></div>
    </div>
  )
}

export default Features