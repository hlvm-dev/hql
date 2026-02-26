import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './contexts/ThemeContext'
import LandingPage from './pages/LandingPage'
import NotFound from './components/NotFound'
import './index.css'

const DocsPage = lazy(() => import('./pages/DocsPage'))

function App() {
  return (
    <ThemeProvider>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/docs/*" element={<DocsPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </ThemeProvider>
  )
}

export default App
