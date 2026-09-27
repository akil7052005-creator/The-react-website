import React from 'react'

function PhotoSelection() {
  return (
    <div>
        <div className='d-flex  gap-4'> 
            <div className="box">
            <input className="four" placeholder="Total Events" />
            </div>
            <div className="box">
            <input className="five" placeholder="Photo Selection" />
            </div>
            <div className="box">
            <input className="six" placeholder="Digital Album"  />
            </div>
            <div className="box">
            <input className="seven" placeholder="Face Recognition"  />
            </div>
        </div>

    </div>
  )
}

export default PhotoSelection