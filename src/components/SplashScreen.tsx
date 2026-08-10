import '../styles/SplashScreen.css'
import { APP_DISPLAY_NAME, APP_TAGLINE, APP_LOGO_SRC, APP_LOGO_ALT } from '../constants/appBranding'

const SplashScreen: React.FC = () => {
  return (
    <div className="splash-screen">
      <div className="splash-content">
        <img 
          src={APP_LOGO_SRC}
          alt={APP_LOGO_ALT}
          className="splash-logo"
        />
        <h1 className="splash-title">{APP_DISPLAY_NAME}</h1>
        <p className="splash-subtitle">{APP_TAGLINE}</p>
        <div className="splash-loader">
          <div className="loader-bar"></div>
        </div>
      </div>
    </div>
  )
}

export default SplashScreen

