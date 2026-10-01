import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState, Spinner } from '../components/ui'
import { api } from '../lib/api'

function Logout() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const signOut = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      // Even if the call failed (e.g. offline), drop everything cached for this user.
      qc.clear()
      toast.success("You're signed out. See you at the next wedding.")
      navigate('/login', { replace: true })
    },
  })

  return (
    <div className="center-page">
      <div className="card">
        <EmptyState
          icon="box-arrow-left"
          title="Sign out of Weddyzone?"
          text="You'll need to sign in again to manage your events and galleries."
          action={
            <div className="page-actions">
              <button className="btn btn-ghost" onClick={() => navigate(-1)} disabled={signOut.isPending}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
                {signOut.isPending && <Spinner size={14} />}
                Sign out
              </button>
            </div>
          }
        />
      </div>
    </div>
  )
}

export default Logout
