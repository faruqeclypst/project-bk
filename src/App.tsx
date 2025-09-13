import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import StudentChat from './StudentChat'
import Teacher from './teacher'

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<StudentChat />} />
        <Route path="/teacher" element={<Teacher />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  )
}
