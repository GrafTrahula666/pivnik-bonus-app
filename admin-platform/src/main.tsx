import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './responsive-fixes.css'
import './ui-polish.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
)
