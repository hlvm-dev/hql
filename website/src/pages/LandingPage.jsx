import NavBar from '../components/NavBar'
import Hero from '../components/Hero'
import Footer from '../components/Footer'

function LandingPage() {
  return (
    <div className="app-container">
      <NavBar />
      <div className="scrollable-content">
        <Hero />
      </div>
      <Footer />
    </div>
  )
}

export default LandingPage
