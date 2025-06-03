/**
 * Konfigurationsdatei für die Lauffer Zeiterfassung App
 */

const CONFIG = {
    // App-Einstellungen
    APP_NAME: 'Lauffer Zeiterfassung',
    COMPANY_NAME: 'Lauffer Gartenbau Erdbau Natursteinhandel',
    VERSION: '1.0.0',
    DEMO_MODE: true, // Wenn true, werden Demo-Daten geladen
    
    // Admin-Zugangsdaten (nur für Demo-Zwecke, in einer echten Anwendung niemals so speichern!)
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'admin123',
    
    // LocalStorage-Schlüssel
    STORAGE_KEYS: {
        EMPLOYEES: 'lauffer_employees',
        PROJECTS: 'lauffer_projects',
        TIME_ENTRIES: 'lauffer_time_entries',
        CURRENT_USER: 'lauffer_current_user',
        CURRENT_ADMIN: 'lauffer_current_admin'
    },
    
    // Einstellungen für die Zeiterfassung
    TIME_TRACKING: {
        LOCATION_TRACKING: true, // Standortverfolgung aktivieren/deaktivieren
        REFRESH_INTERVAL: 1000, // Intervall für Zeitaktualisierung in Millisekunden
        MAX_WORK_HOURS: 12, // Maximale Arbeitszeit pro Tag in Stunden
    },
    
    // Benachrichtigungseinstellungen
    NOTIFICATIONS: {
        ENABLED: true,
        AUTO_DISMISS: 5000, // Zeit in Millisekunden, bis Benachrichtigungen automatisch verschwinden
    }
};

// Verhindern, dass die Konfiguration geändert wird
Object.freeze(CONFIG);
