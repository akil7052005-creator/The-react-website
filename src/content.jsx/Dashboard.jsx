import React from 'react'

function Dashboard() {
  return (
        <div>
            <div className='buttons d-flex gap-4'>
                <button className='newSelection'>New Sellection</button>
                <button className='digitalAlbum'>Digital Album</button>
                <button className='aiFace'>Ai-Face</button>
                <button className='allAccess'>All Access Plan</button>
            </div>

            <div>
                <img className='wedimg' src="src\assets\wedding-poster-horizontal.png" alt="Image" />
            </div>

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

            <div className='d-flex  gap-4'>
                <div>
                <input className='B' placeholder='Create Bill'/>
                </div>
                <div>
                <input className='I' placeholder='Manage Website'/>
                </div>
                <div>
                <input className='L' placeholder='Whatsapp Credit'/>
                </div>
            </div>

            <div className='d-flex  gap-4'>
                <div>
                    <input className='Analytics' placeholder='Event Analytics'/>
                </div>
                <div>
                    <input className='Albums' placeholder='Recent Album'/>
                </div>
            </div>

            {/* <table className="w-full border-collapse">
            <thead>
                <tr className="bg-gray-100 text-left">
                <th className="p-2">Name</th>
                <th className="p-2">Email</th>
                <th className="p-2">Phone</th>
                </tr>
            </thead>
            <tbody>
                {registrations.map((r) => (
                <tr key={r.id} className="border-b">
                    <td className="p-2">{r.name}</td>
                    <td className="p-2">{r.email}</td>
                    <td className="p-2">{r.phone}</td>
                </tr>
                ))}
            </tbody> */}
            {/* </table> */}

            <table className='recors-table'>
                <thead>
                <tr>
                    <th>Event Id</th>
                    <th>Evet Name</th>
                    <th>Customer</th>
                    <th>Date</th>
                    <th>Status</th>
                </tr>
                </thead>
            </table>

            <div className='d-flex  gap-4'>
                <div>
                <input className='DOA' placeholder='Download Our App'/>
                </div>
                <div>
                <input className='PP' placeholder='Project Progrss'/>
                </div>
                <div>
                <input className='CA' placeholder='Client Activity'/>
                </div>
            </div>
        </div>
    
  )
}

export default Dashboard