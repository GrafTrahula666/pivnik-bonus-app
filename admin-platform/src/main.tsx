import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './responsive-fixes.css'
import './ui-polish.css'
import './animations.css'
import App from './App'
import { InviteClaim } from './InviteClaim'

// No client router: the one public (unauthenticated) page is matched by path before App's
// own session check, so a stale invite link never depends on an existing admin session.
const inviteMatch=/^\/invite\/([^/]+)\/?$/.exec(window.location.pathname)

createRoot(document.getElementById('root')!).render(
  <StrictMode>{inviteMatch?<InviteClaim token={decodeURIComponent(inviteMatch[1]!)}/>:<App />}</StrictMode>,
)
