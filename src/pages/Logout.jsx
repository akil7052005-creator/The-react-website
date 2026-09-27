import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { EmptyState } from '../components/ui'

function Logout() {
  const navigate = useNavigate()
  const [done, setDone] = useState(false)

  return (
    <div className="center-page">
      <div className="card">
        {done ? (
          <EmptyState
            icon="check2-circle"
            title="You're signed out"
            text="See you at the next wedding."
            action={<Link to="/" className="btn btn-primary">Sign back in</Link>}
          />
        ) : (
          <EmptyState
            icon="box-arrow-left"
            title="Sign out of Weddingz?"
            text="You'll need to sign in again to manage your events and galleries."
            action={
              <div className="page-actions">
                <button className="btn btn-ghost" onClick={() => navigate(-1)}>Cancel</button>
                {/* TODO: clear the auth session here once login is added */}
                <button className="btn btn-primary" onClick={() => setDone(true)}>Sign out</button>
              </div>
            }
          />
        )}
      </div>
    </div>
  )
}

export default Logout
