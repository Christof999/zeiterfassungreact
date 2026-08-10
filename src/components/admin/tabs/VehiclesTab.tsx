import { useState, useEffect, useMemo } from 'react'
import { DataService } from '../../../services/dataService'
import type { Vehicle } from '../../../types'
import { toast } from '../../ToastContainer'
import VehicleModal from '../VehicleModal'
import ListSearch from '../ListSearch'
import '../../../styles/AdminTabs.css'

const VehiclesTab: React.FC = () => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [deletingVehicleId, setDeletingVehicleId] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  const filteredVehicles = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return vehicles
    return vehicles.filter((vehicle) =>
      [vehicle.name, vehicle.licensePlate]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term))
    )
  }, [vehicles, searchTerm])

  useEffect(() => {
    loadVehicles()
  }, [])

  const loadVehicles = async () => {
    try {
      const allVehicles = await DataService.getAllVehicles()
      setVehicles(allVehicles)
    } catch (error) {
      console.error('Fehler beim Laden der Fahrzeuge:', error)
      toast.error('Fehler beim Laden der Fahrzeuge')
    } finally {
      setIsLoading(false)
    }
  }

  const handleAdd = () => {
    setEditingVehicle(null)
    setShowModal(true)
  }

  const handleEdit = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle)
    setShowModal(true)
  }

  const handleSave = () => {
    setShowModal(false)
    setEditingVehicle(null)
    loadVehicles()
  }

  const handleDelete = async (vehicle: Vehicle) => {
    if (!vehicle.id) return

    if (!confirm(`Fahrzeug "${vehicle.name}" wirklich löschen?`)) {
      return
    }

    setDeletingVehicleId(vehicle.id)
    try {
      await DataService.deleteVehicle(vehicle.id)
      toast.success('Fahrzeug gelöscht')
      await loadVehicles()
    } catch (error: any) {
      toast.error('Fehler beim Löschen: ' + error.message)
    } finally {
      setDeletingVehicleId(null)
    }
  }

  if (isLoading) {
    return <div className="loading">Lade Fahrzeuge...</div>
  }

  return (
    <div className="vehicles-tab">
      <div className="tab-header">
        <h3>Fahrzeuge</h3>
        <button onClick={handleAdd} className="btn primary-btn">
          Fahrzeug hinzufügen
        </button>
      </div>

      {vehicles.length === 0 ? (
        <p className="no-data">Keine Fahrzeuge vorhanden</p>
      ) : (
        <>
          <ListSearch
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Fahrzeug suchen (Name, Kennzeichen)"
          />
          {filteredVehicles.length === 0 ? (
            <p className="no-data">Keine Treffer für „{searchTerm}"</p>
          ) : (
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Kennzeichen</th>
                <th>Kosten €/Std</th>
                <th>Verrechnung €/Std</th>
                <th>Status</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {filteredVehicles.map((vehicle) => (
                <tr key={vehicle.id}>
                  <td data-label="Name">{vehicle.name}</td>
                  <td data-label="Kennzeichen">{vehicle.licensePlate || '-'}</td>
                  <td data-label="Kosten €/Std">
                    {vehicle.hourlyRate ? `${vehicle.hourlyRate.toFixed(2)} €` : '-'}
                  </td>
                  <td data-label="Verrechnung €/Std">
                    {vehicle.hourlyBillingRate ? `${vehicle.hourlyBillingRate.toFixed(2)} €` : '-'}
                  </td>
                  <td data-label="Status">
                    <span className={`status-badge ${vehicle.isActive !== false ? 'active' : 'inactive'}`}>
                      {vehicle.isActive !== false ? 'Aktiv' : 'Inaktiv'}
                    </span>
                  </td>
                  <td className="action-buttons" data-label="">
                    <button 
                      onClick={() => handleEdit(vehicle)} 
                      className="action-btn edit-btn"
                      aria-label="Bearbeiten"
                    >
                      Bearbeiten
                    </button>
                    <button
                      onClick={() => handleDelete(vehicle)}
                      className="action-btn delete-btn"
                      aria-label="Löschen"
                      disabled={deletingVehicleId === vehicle.id}
                      title="Fahrzeug löschen"
                    >
                      {deletingVehicleId === vehicle.id ? 'Löscht...' : 'Löschen'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
          )}
        </>
      )}

      {showModal && (
        <VehicleModal
          vehicle={editingVehicle}
          onClose={() => {
            setShowModal(false)
            setEditingVehicle(null)
          }}
          onSave={handleSave}
        />
      )}
    </div>
  )
}

export default VehiclesTab

