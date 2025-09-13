import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import Teacher from './teacher.tsx'

function Root() {
  const isTeacher = typeof window !== 'undefined' && window.location.pathname.toLowerCase().includes('/teacher')
  return (
    <StrictMode>
      {isTeacher ? <Teacher /> : <App />}
    </StrictMode>
  )
}

createRoot(document.getElementById('root')!).render(<Root />)
