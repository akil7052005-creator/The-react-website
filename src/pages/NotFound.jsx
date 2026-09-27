import { Link } from 'react-router-dom'
import { EmptyState } from '../components/ui'

function NotFound() {
  return (
    <div className="center-page">
      <div className="card">
        <EmptyState
          icon="signpost-split"
          title="Page not found"
          text="The page you're looking for doesn't exist or has moved."
          action={<Link to="/" className="btn btn-primary">Back to dashboard</Link>}
        />
      </div>
    </div>
  )
}

export default NotFound
