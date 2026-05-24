import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { DataService } from '../services/dataService'

type GateStatus = 'loading' | 'active' | 'inactive'

/** Blockiert Mitarbeiter-Routen, wenn die App für Mitarbeiter deaktiviert ist. */
const EmployeeAppGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<GateStatus>('loading')

  useEffect(() => {
    let cancelled = false

    const check = async () => {
      await DataService.authReady
      const active = await DataService.isEmployeeAppActive()
      if (cancelled) return
      if (!active) {
        DataService.clearCurrentUser()
        setStatus('inactive')
      } else {
        setStatus('active')
      }
    }

    check()
    return () => {
      cancelled = true
    }
  }, [])

  if (status === 'loading') {
    return <div className="loading">Lade...</div>
  }

  if (status === 'inactive') {
    return <Navigate to="/app-inactive" replace />
  }

  return <>{children}</>
}

export default EmployeeAppGate
