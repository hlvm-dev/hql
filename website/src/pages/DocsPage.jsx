import { DocsProvider } from '../contexts/DocsContext'
import DocsLayout from '../components/docs/DocsLayout'
import NavBar from '../components/NavBar'
import Footer from '../components/Footer'

function DocsPage() {
  return (
    <DocsProvider>
      <div className="app-container docs-app">
        <NavBar />
        <div className="scrollable-content">
          <DocsLayout />
        </div>
        <Footer />
      </div>
    </DocsProvider>
  )
}

export default DocsPage
