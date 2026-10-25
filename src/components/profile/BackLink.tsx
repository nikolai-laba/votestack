import { Link, useLocation, useNavigate } from 'react-router'
import {
  GET_STARTED_PATH,
  isProfileLinkState,
} from '../../ballot/profileLinks.ts'
import { usage } from '../../metrics/usage.ts'
import { usagePage } from '../../shared/metrics.ts'

/**
 * Names where it goes: "Back to your full ballot", or, with
 * no ballot in memory (a shared link), "Find your ballot" to the address form.
 */
export function BackLink({ hasBallot }: { hasBallot: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()
  const fromRow = isProfileLinkState(location.state)
  const className = 'inline-flex min-h-11 items-center'

  if (!hasBallot) {
    return (
      <Link
        to={GET_STARTED_PATH}
        className={className}
        onClick={() => usage.cta('back', usagePage(location.pathname).page)}
      >
        Find your ballot
      </Link>
    )
  }
  return (
    <Link
      to="/"
      className={className}
      onClick={(event) => {
        // Opened from a ballot row: going back in history returns to the
        // ballot without leaving an extra entry behind, and HomePage puts
        // focus back on that row.
        if (!fromRow) return
        event.preventDefault()
        navigate(-1)
      }}
    >
      Back to your full ballot
    </Link>
  )
}
