import { useNavigate } from 'react-router-dom'
import ThemeToggle from './ThemeToggle'
import '../styles/AppInactiveScreen.css'

const LOGO_URL = 'https://anfragenmanager.s3.eu-central-1.amazonaws.com/Logo_Lauffer_RGB.png'

const AppInactiveScreen: React.FC = () => {
  const navigate = useNavigate()

  return (
    <div className="app-inactive-container">
      <header className="app-inactive-header">
        <ThemeToggle variant="icon" className="app-inactive-theme-toggle" />
        <div className="app-inactive-logo">
          <img src={LOGO_URL} alt="Lauffer Logo" className="app-inactive-logo-image" />
          <h1>Lauffer Zeiterfassung</h1>
          <p>Gartenbau • Erdbau • Natursteinhandel</p>
        </div>
      </header>

      <main className="app-inactive-main">
        <div className="app-inactive-message">
          <h2>Die App ist inaktiv</h2>
          <p>
            Die Mitarbeiter-Zeiterfassung ist derzeit nicht verfügbar. Bitte wenden Sie sich an Ihre
            Verwaltung.
          </p>
          <button
            type="button"
            className="btn secondary-btn app-inactive-admin-btn"
            onClick={() => navigate('/admin/login')}
          >
            Admin-Bereich
          </button>
        </div>
      </main>
    </div>
  )
}

export default AppInactiveScreen
