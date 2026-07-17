import { useEffect, useMemo, useRef, useState } from 'react'
import { Circle, CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import {
  cloudEnabled,
  createStaffAccount,
  login,
  logout,
  observeSession,
  registerCitizen,
  saveNotice,
  saveReport,
  saveRoute,
  subscribeNotices,
  subscribeReports,
  subscribeRoute,
  subscribeUsers,
  updateReportStatus,
} from './data'
import { requestNotificationPermission, sendDeviceNotification } from './notifications'
import './App.css'

const COMMUNITY = [20.0542, -99.2768]
const REPORTS_KEY = 'ruta-limpia-reports'
const NOTICES_KEY = 'ruta-limpia-notices'
const ROUTE_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const DEFAULT_ROUTE_PLAN = {
  day: 'Martes',
  time: '08:00',
  name: 'Ruta centro',
}
const DEFAULT_ROUTE_POINTS = [
  [20.0572, -99.2812],
  [20.0551, -99.2787],
  [20.0535, -99.2754],
  [20.0518, -99.2729],
]
const NEAR_TRUCK_METERS = 250
const AUTH_ANIMATION_MS = 980

const distanceInMeters = ([latA, lngA], [latB, lngB]) => {
  const earthRadius = 6371000
  const toRad = (value) => value * Math.PI / 180
  const dLat = toRad(latB - latA)
  const dLng = toRad(lngB - lngA)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLng / 2) ** 2
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function AuthTransition({ type }) {
  const isOut = type === 'out'
  return (
    <div className="session-transition" role="status" aria-live="polite">
      <div className="session-pulse"><span></span><span></span><span></span></div>
      <b>{isOut ? 'Cerrando sesión' : 'Abriendo panel'}</b>
      <small>{isOut ? 'Guardando cambios locales' : 'Sincronizando ruta, reportes y avisos'}</small>
      <div className="session-progress"><i></i></div>
    </div>
  )
}

function AuthModal({ onClose, onAuthenticated, notify }) {
  const [mode, setMode] = useState('login')
  const [loading, setLoading] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))
    setLoading(true)
    try {
      if (mode === 'register') await registerCitizen(values)
      else await login(values)
      await onAuthenticated(mode === 'register' ? 'Cuenta creada correctamente' : 'Sesión iniciada')
    } catch (error) {
      notify(error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="modal-close" onClick={onClose} aria-label="Cerrar">×</button>
        <div className="auth-orbit" aria-hidden="true"><span></span><span></span><span></span></div>
        <span className="auth-logo">♻</span>
        <span className="eyebrow">RUTA LIMPIA</span>
        <h2 id="auth-title">{mode === 'login' ? 'Bienvenido de vuelta' : 'Crea tu cuenta'}</h2>
        <p>{mode === 'login' ? 'Ingresa para acceder a las funciones de tu perfil.' : 'El registro público crea una cuenta ciudadana.'}</p>
        {!cloudEnabled && <div className="auth-warning">Modo demostración: conecta la API para activar cuentas reales.</div>}
        <form onSubmit={submit}>
          {mode === 'register' && <label>Nombre completo<input name="name" required minLength="2" autoComplete="name" placeholder="Tu nombre" /></label>}
          <label>Correo electrónico<input name="email" type="email" required autoComplete="email" placeholder="nombre@correo.com" /></label>
          <label>Contraseña<input name="password" type="password" required minLength="6" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="Mínimo 6 caracteres" /></label>
          <button className="primary-button auth-submit" disabled={loading || !cloudEnabled}>{loading ? <span><i></i>Conectando</span> : mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta ciudadana'}</button>
        </form>
        <button className="auth-switch" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? '¿No tienes cuenta? Crear una' : 'Ya tengo una cuenta'}
        </button>
        <small className="staff-note">Las cuentas de chofer y delegación son autorizadas por un administrador.</small>
      </section>
    </div>
  )
}

function ReportModal({ onClose, onSubmit, loading }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="auth-modal report-modal" role="dialog" aria-modal="true" aria-labelledby="report-title">
        <button className="modal-close" onClick={onClose} aria-label="Cerrar">×</button>
        <div className="auth-orbit" aria-hidden="true"><span></span><span></span><span></span></div>
        <span className="auth-logo">⚑</span>
        <span className="eyebrow">REPORTE CIUDADANO</span>
        <h2 id="report-title">Reportar basura</h2>
        <p>Comparte la ubicación del punto para que el personal pueda localizarlo y atenderlo.</p>
        <form onSubmit={onSubmit}>
          <label>Tipo de problema<select name="category" defaultValue="Basura acumulada"><option>Basura acumulada</option><option>Contenedor lleno</option><option>Residuos peligrosos</option><option>Escombro</option><option>Otro</option></select></label>
          <label>Descripción<textarea name="details" maxLength="240" placeholder="Referencia del lugar o detalles útiles" /></label>
          <div className="location-hint">⌖ Al enviar se solicitará tu ubicación actual.</div>
          <button className="primary-button" disabled={loading}>{loading ? 'Obteniendo ubicación…' : 'Enviar reporte'}</button>
        </form>
      </section>
    </div>
  )
}

function ReportQueue({ reports, onStatus, onAddStop }) {
  const pending = reports.filter((report) => report.status !== 'resolved')
  return (
    <div className="report-queue">
      <div className="staff-list-title"><h3>Reportes ciudadanos</h3><span>{pending.length} pendientes</span></div>
      <p>Los puntos aparecen en tiempo real para que el personal los atienda durante el recorrido.</p>
      {pending.length === 0 ? <div className="empty-state">No hay reportes pendientes.</div> : pending.map((report) => (
        <article key={report.id}>
          <div><b>{report.category || 'Basura acumulada'}</b><small>{report.details || 'Sin descripción'} · {report.date}</small><code>{Number(report.lat).toFixed(5)}, {Number(report.lng).toFixed(5)}</code></div>
          <div className="report-actions">
            {onAddStop && <button onClick={() => onAddStop(report)}>Sumar a ruta</button>}
            {report.status === 'open' && <button onClick={() => onStatus(report.id, 'attending')}>Atender</button>}
            <button className="resolve" onClick={() => onStatus(report.id, 'resolved')}>Resolver</button>
          </div>
        </article>
      ))}
    </div>
  )
}

function Recenter({ position }) {
  const map = useMap()
  useEffect(() => { map.flyTo(position, map.getZoom(), { duration: 0.8 }) }, [map, position])
  return null
}

function RouteClickHandler({ onAddPoint }) {
  useMapEvents({
    click(event) {
      onAddPoint([event.latlng.lat, event.latlng.lng])
    },
  })
  return null
}

function LiveMap({ truckPosition, suspended, reports, routePoints = [], editable = false, onAddPoint }) {
  const visibleRoute = routePoints.length ? routePoints : DEFAULT_ROUTE_POINTS
  const fullRoute = [truckPosition, ...visibleRoute]
  return (
    <MapContainer center={truckPosition} zoom={15} scrollWheelZoom={false} className="leaflet-map" aria-label="Mapa en vivo de la ruta">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Circle center={COMMUNITY} radius={1000} pathOptions={{ color: '#16834c', fillColor: '#aadd58', fillOpacity: 0.08, weight: 2 }} />
      <Polyline positions={fullRoute} pathOptions={{ color: suspended ? '#b9453c' : '#fc4c02', weight: 5, opacity: 0.78, dashArray: suspended ? '10 12' : undefined }} />
      <CircleMarker center={COMMUNITY} radius={8} pathOptions={{ color: '#fff', fillColor: '#16834c', fillOpacity: 1, weight: 4 }}>
        <Popup>Centro de Pueblo Nuevo Jasso</Popup>
      </CircleMarker>
      {visibleRoute.map((point, index) => (
        <CircleMarker key={`${point[0]}-${point[1]}-${index}`} center={point} radius={7} pathOptions={{ color: '#fff', fillColor: '#111111', fillOpacity: 1, weight: 3 }}>
          <Popup>Parada {index + 1}</Popup>
        </CircleMarker>
      ))}
      <CircleMarker center={truckPosition} radius={15} pathOptions={{ color: '#fff', fillColor: suspended ? '#b9453c' : '#0d6137', fillOpacity: 1, weight: 5 }}>
        <Popup>{suspended ? 'Unidad detenida por avería' : 'Camión recolector en ruta'}</Popup>
      </CircleMarker>
      {reports.map((report) => (
        <CircleMarker key={report.id} center={[report.lat, report.lng]} radius={8} pathOptions={{ color: '#fff', fillColor: '#e45c4c', fillOpacity: 1, weight: 3 }}>
          <Popup>Punto crítico reportado<br />{report.date}</Popup>
        </CircleMarker>
      ))}
      {editable && onAddPoint && <RouteClickHandler onAddPoint={onAddPoint} />}
      <Recenter position={truckPosition} />
    </MapContainer>
  )
}

function App() {
  const [view, setView] = useState('citizen')
  const [user, setUser] = useState(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [sessionTransition, setSessionTransition] = useState(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [routeActive, setRouteActive] = useState(false)
  const [suspended, setSuspended] = useState(false)
  const [toast, setToast] = useState('')
  const [gpsState, setGpsState] = useState('idle')
  const [syncState, setSyncState] = useState(cloudEnabled ? 'connecting' : 'local')
  const [truckPosition, setTruckPosition] = useState(COMMUNITY)
  const [routePlan, setRoutePlan] = useState(DEFAULT_ROUTE_PLAN)
  const [routePoints, setRoutePoints] = useState(DEFAULT_ROUTE_POINTS)
  const [nearbyDistance, setNearbyDistance] = useState(null)
  const [failureText, setFailureText] = useState('Avería mecánica')
  const [reports, setReports] = useState(() => JSON.parse(localStorage.getItem(REPORTS_KEY) || '[]'))
  const [notices, setNotices] = useState(() => JSON.parse(localStorage.getItem(NOTICES_KEY) || '[]'))
  const [users, setUsers] = useState([])
  const [creatingStaff, setCreatingStaff] = useState(false)
  const [alertsEnabled, setAlertsEnabled] = useState(() => localStorage.getItem('ruta-limpia-alerts') === 'on')
  const watchId = useRef(null)
  const lastSentAt = useRef(0)
  const previousOpenReports = useRef(null)
  const previousRouteStatus = useRef(null)
  const previousNoticeCount = useRef(null)
  const nearTruckNotified = useRef(false)

  const coords = useMemo(() => `${truckPosition[0].toFixed(5)}, ${truckPosition[1].toFixed(5)}`, [truckPosition])
  const routeLabel = `${routePlan.day} ${routePlan.time} · ${routePlan.name}`
  const openReportsCount = reports.filter((item) => item.status === 'open').length
  const activeRouteDistance = nearbyDistance !== null ? `${nearbyDistance} m` : routeActive ? 'GPS' : routePlan.time
  const feed = notices.length ? notices : [
    { id: 'demo-1', date: 'Hoy · 7:42', title: 'Ruta en curso', text: 'La unidad salió del taller municipal.' },
    { id: 'demo-2', date: 'Sábado · 8:10', title: 'Servicio completado', text: 'La recolección terminó sin incidentes.' },
  ]

  useEffect(() => () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
  }, [])

  useEffect(() => observeSession((session) => {
    setUser(session)
    if (!session || session.role === 'citizen') setView('citizen')
  }), [])

  useEffect(() => {
    if (!cloudEnabled) return undefined
    const handleError = () => setSyncState('error')
    const unsubNotices = subscribeNotices((items) => { setNotices(items); setSyncState('cloud') }, handleError)
    const unsubReports = subscribeReports((items) => { setReports(items); setSyncState('cloud') }, handleError)
    const unsubRoute = subscribeRoute((route) => {
      if (Number.isFinite(route.lat) && Number.isFinite(route.lng)) setTruckPosition([route.lat, route.lng])
      setRoutePlan({
        day: route.day || DEFAULT_ROUTE_PLAN.day,
        time: route.time || DEFAULT_ROUTE_PLAN.time,
        name: route.name || DEFAULT_ROUTE_PLAN.name,
      })
      if (Array.isArray(route.points)) setRoutePoints(route.points)
      setRouteActive(route.status === 'active')
      setSuspended(route.status === 'suspended')
      setSyncState('cloud')
    }, handleError)
    return () => { unsubNotices(); unsubReports(); unsubRoute() }
  }, [])

  useEffect(() => {
    const openCount = reports.filter((report) => report.status === 'open').length
    if (previousOpenReports.current !== null && openCount > previousOpenReports.current && alertsEnabled && ['driver', 'admin'].includes(user?.role)) {
      sendDeviceNotification('Nuevo reporte ciudadano', 'Hay un nuevo punto de basura pendiente por atender.').catch(() => {})
    }
    previousOpenReports.current = openCount
  }, [alertsEnabled, reports, user?.role])

  useEffect(() => {
    const status = suspended ? 'suspended' : routeActive ? 'active' : 'inactive'
    if (previousRouteStatus.current && status !== previousRouteStatus.current && alertsEnabled && user?.role !== 'driver') {
      const messages = {
        active: ['Camión en ruta', 'La unidad inició el recorrido y ya puedes consultar su ubicación.'],
        suspended: ['Ruta suspendida', 'La unidad reportó una incidencia durante el recorrido.'],
        inactive: ['Ruta finalizada', 'La unidad dejó de compartir su ubicación.'],
      }
      sendDeviceNotification(...messages[status]).catch(() => {})
    }
    previousRouteStatus.current = status
  }, [alertsEnabled, routeActive, suspended, user?.role])

  useEffect(() => {
    if (previousNoticeCount.current !== null && notices.length > previousNoticeCount.current && alertsEnabled && user?.role !== 'driver') {
      const [latest] = notices
      sendDeviceNotification(latest.title || 'Ruta Limpia', latest.text || 'Hay un nuevo aviso de la ruta.').catch(() => {})
    }
    previousNoticeCount.current = notices.length
  }, [alertsEnabled, notices, user?.role])

  useEffect(() => {
    if (!alertsEnabled || !routeActive || suspended || user?.role === 'driver' || !navigator.geolocation) {
      setNearbyDistance(null)
      nearTruckNotified.current = false
      return undefined
    }
    const proximityWatch = navigator.geolocation.watchPosition(
      ({ coords: current }) => {
        const distance = Math.round(distanceInMeters([current.latitude, current.longitude], truckPosition))
        setNearbyDistance(distance)
        if (distance <= NEAR_TRUCK_METERS && !nearTruckNotified.current) {
          nearTruckNotified.current = true
          sendDeviceNotification('Camión cerca', `La unidad está a unos ${distance} m. Prepara tus residuos.`).catch(() => {})
          notify(`Camión cerca: aproximadamente ${distance} m`)
        }
        if (distance > NEAR_TRUCK_METERS * 2) nearTruckNotified.current = false
      },
      () => setNearbyDistance(null),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 15000 },
    )
    return () => navigator.geolocation.clearWatch(proximityWatch)
  }, [alertsEnabled, routeActive, suspended, truckPosition, user?.role])

  useEffect(() => {
    if (user?.role !== 'admin') {
      setUsers([])
      return undefined
    }
    return subscribeUsers(setUsers, () => notify('No se pudo cargar la lista de cuentas'))
  }, [user?.role])

  const notify = (message) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 3200)
  }

  const completeAuthentication = async (message) => {
    setSessionTransition('in')
    notify(message)
    await new Promise((resolve) => window.setTimeout(resolve, AUTH_ANIMATION_MS))
    setAuthOpen(false)
    setSessionTransition(null)
  }

  const signOutUser = async () => {
    setSessionTransition('out')
    await new Promise((resolve) => window.setTimeout(resolve, AUTH_ANIMATION_MS * 0.72))
    await logout()
    setView('citizen')
    notify('Sesión cerrada')
    await new Promise((resolve) => window.setTimeout(resolve, 240))
    setSessionTransition(null)
  }

  const stopGps = async () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
    watchId.current = null
    setRouteActive(false)
    setGpsState('idle')
    await saveRoute({ status: 'inactive', ...routePlan, points: routePoints }).catch(() => setSyncState('error'))
  }

  const startGps = () => {
    if (!navigator.geolocation) {
      setGpsState('error')
      notify('Este dispositivo no ofrece ubicación GPS')
      return
    }
    setGpsState('requesting')
    watchId.current = navigator.geolocation.watchPosition(
      ({ coords: current }) => {
        setTruckPosition([current.latitude, current.longitude])
        setRouteActive(true)
        setSuspended(false)
        setGpsState('tracking')
        const now = Date.now()
        if (now - lastSentAt.current >= 15000) {
          lastSentAt.current = now
          saveRoute({ lat: current.latitude, lng: current.longitude, status: 'active', ...routePlan, points: routePoints }).catch(() => setSyncState('error'))
        }
      },
      () => {
        setGpsState('error')
        setRouteActive(false)
        notify('No se pudo usar el GPS. Revisa el permiso de ubicación.')
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    )
  }

  const requestAlerts = async () => {
    const granted = await requestNotificationPermission()
    if (!granted) return notify('Las notificaciones no fueron autorizadas')
    localStorage.setItem('ruta-limpia-alerts', 'on')
    setAlertsEnabled(true)
    await sendDeviceNotification('Ruta Limpia', 'Las alertas de ruta quedaron activadas.')
    notify('Notificaciones activadas')
  }

  const addReport = (event) => {
    event.preventDefault()
    if (!navigator.geolocation) return notify('Este dispositivo no ofrece ubicación GPS')
    const values = Object.fromEntries(new FormData(event.currentTarget))
    setReporting(true)
    notify('Obteniendo tu ubicación…')
    navigator.geolocation.getCurrentPosition(
      ({ coords: current }) => {
        const report = { id: crypto.randomUUID(), lat: current.latitude, lng: current.longitude, category: values.category, details: values.details, status: 'open', date: new Date().toLocaleString('es-MX') }
        saveReport(report).then((savedInCloud) => {
          if (!savedInCloud) {
            const next = [...reports, report]
            setReports(next)
            localStorage.setItem(REPORTS_KEY, JSON.stringify(next))
          }
          setReportOpen(false)
          setReporting(false)
          notify(savedInCloud ? 'Reporte sincronizado con la comunidad' : 'Punto crítico guardado en este dispositivo')
        }).catch(() => { setReporting(false); notify('No se pudo guardar el reporte') })
      },
      () => { setReporting(false); notify('Necesitamos permiso de ubicación para crear el reporte') },
      { enableHighAccuracy: true, timeout: 12000 },
    )
  }

  const changeReportStatus = async (reportId, status) => {
    try {
      await updateReportStatus(reportId, status)
      notify(status === 'attending' ? 'Reporte asignado para atención' : 'Reporte marcado como resuelto')
    } catch {
      notify('No se pudo actualizar el reporte')
    }
  }

  const persistRoutePoints = async (nextPoints, message = 'Ruta actualizada') => {
    setRoutePoints(nextPoints)
    const savedInCloud = await saveRoute({
      status: routeActive ? 'active' : suspended ? 'suspended' : 'inactive',
      ...routePlan,
      points: nextPoints,
    }).catch(() => false)
    notify(savedInCloud ? message : 'Ruta guardada en este dispositivo')
  }

  const addRoutePoint = (point) => {
    persistRoutePoints([...routePoints, point], 'Parada agregada a la ruta')
  }

  const undoRoutePoint = () => {
    if (routePoints.length === 0) return notify('No hay paradas para quitar')
    persistRoutePoints(routePoints.slice(0, -1), 'Última parada retirada')
  }

  const resetRoutePoints = () => {
    persistRoutePoints([], 'Ruta limpiada')
  }

  const addReportToRoute = (report) => {
    if (!Number.isFinite(report.lat) || !Number.isFinite(report.lng)) return notify('El reporte no tiene ubicación válida')
    persistRoutePoints([...routePoints, [Number(report.lat), Number(report.lng)]], 'Reporte sumado a la ruta')
    updateReportStatus(report.id, 'attending').catch(() => {})
  }

  const updateRoutePlan = async (event) => {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))
    const nextPlan = { day: values.day, time: values.time, name: values.name.trim() || DEFAULT_ROUTE_PLAN.name }
    setRoutePlan(nextPlan)
    const savedInCloud = await saveRoute({ status: routeActive ? 'active' : suspended ? 'suspended' : 'inactive', ...nextPlan, points: routePoints }).catch(() => false)
    const notice = { id: crypto.randomUUID(), date: 'Ahora', title: 'Horario de ruta actualizado', text: `${nextPlan.name}: ${nextPlan.day} a las ${nextPlan.time}.` }
    const noticeSaved = await saveNotice(notice).catch(() => false)
    if (!noticeSaved) {
      const next = [notice, ...notices]
      setNotices(next)
      localStorage.setItem(NOTICES_KEY, JSON.stringify(next))
    }
    notify(savedInCloud ? 'Horario sincronizado y usuarios notificados' : 'Horario guardado en este dispositivo')
  }

  const reportBreakdown = async () => {
    await stopGps()
    setSuspended(true)
    const reason = failureText.trim() || 'Avería mecánica'
    const notice = { id: crypto.randomUUID(), date: 'Ahora', title: 'Ruta suspendida', text: `La unidad reportó: ${reason}. Ruta afectada: ${routeLabel}.` }
    const savedInCloud = await saveNotice(notice).catch(() => false)
    await saveRoute({ status: 'suspended', failure: reason, ...routePlan, points: routePoints }).catch(() => setSyncState('error'))
    if (!savedInCloud) {
      const next = [notice, ...notices]
      setNotices(next)
      localStorage.setItem(NOTICES_KEY, JSON.stringify(next))
    }
    notify(savedInCloud ? 'Alerta de avería sincronizada' : 'Alerta guardada en este dispositivo')
  }

  const sendNotice = async () => {
    const text = document.querySelector('#message')?.value.trim()
    if (!text) return notify('Escribe el aviso antes de enviarlo')
    const notice = { id: crypto.randomUUID(), date: 'Ahora', title: 'Aviso de la delegación', text }
    const savedInCloud = await saveNotice(notice).catch(() => false)
    if (!savedInCloud) {
      const next = [notice, ...notices]
      setNotices(next)
      localStorage.setItem(NOTICES_KEY, JSON.stringify(next))
    }
    notify(savedInCloud ? 'Aviso sincronizado con la comunidad' : 'Aviso publicado en este dispositivo')
  }

  const createStaff = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    setCreatingStaff(true)
    try {
      await createStaffAccount(values)
      form.reset()
      notify(values.role === 'admin' ? 'Cuenta de Delegación creada' : 'Cuenta de chofer creada')
    } catch (error) {
      notify(error.message)
    } finally {
      setCreatingStaff(false)
    }
  }

  return (
    <div className={`app-shell ${sessionTransition ? 'session-is-transitioning' : ''}`}>
      {toast && <div className="toast" role="status">{toast}</div>}
      {sessionTransition && <AuthTransition type={sessionTransition} />}
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} onAuthenticated={completeAuthentication} notify={notify} />}
      {reportOpen && <ReportModal onClose={() => !reporting && setReportOpen(false)} onSubmit={addReport} loading={reporting} />}
      <header>
        <a className="brand" href="#" aria-label="Ruta Limpia, inicio"><span className="brand-mark">♻</span><span><b>Ruta Limpia</b><small>Pueblo Nuevo Jasso</small></span></a>
        <div className="account-area">
          {user ? <>
            <span className="account-copy"><b>{user.name}</b><small>{user.role === 'admin' ? 'Delegación' : user.role === 'driver' ? 'Chofer' : 'Ciudadano'}</small></span>
            <button className="profile" onClick={signOutUser} aria-label="Cerrar sesión">{user.name.slice(0, 2).toUpperCase()}</button>
          </> : <button className="login-button" onClick={() => setAuthOpen(true)}>Iniciar sesión</button>}
        </div>
      </header>

      <main>
        <section className="welcome">
          <div><span className="eyebrow">SERVICIO DE RECOLECCIÓN</span><h1>Hola{user ? `, ${user.name.split(' ')[0]}` : ''} <span>👋</span></h1><p>La información que necesitas para sacar tus residuos justo a tiempo.</p></div>
          <div className="welcome-actions">
            <div className={`sync-pill ${syncState}`}>{syncState === 'cloud' ? '● MongoDB conectado' : syncState === 'connecting' ? '◌ Conectando…' : syncState === 'error' ? '● Error de conexión' : '● Base local'}</div>
            <div className="day-pill">◷ Ruta asignada: <b>{routeLabel}</b></div>
          </div>
        </section>
        <nav className="role-tabs" aria-label="Cambiar tipo de usuario">
          <button className={view === 'citizen' ? 'active' : ''} onClick={() => setView('citizen')}>Comunidad</button>
          {user?.role === 'driver' && <button className={view === 'driver' ? 'active' : ''} onClick={() => setView('driver')}>Mi ruta</button>}
          {user?.role === 'admin' && <button className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}>Delegación</button>}
        </nav>

        <section className="activity-strip" aria-label="Resumen de ruta">
          <article><span>Estado</span><b>{suspended ? 'Pausada' : routeActive ? 'En vivo' : 'Programada'}</b><small>{routePlan.name}</small></article>
          <article><span>Cercanía</span><b>{activeRouteDistance}</b><small>{routeActive ? 'del camión' : 'salida estimada'}</small></article>
          <article><span>Recorrido</span><b>{routePoints.length}</b><small>paradas trazadas</small></article>
          <article><span>Reportes</span><b>{openReportsCount}</b><small>pendientes</small></article>
        </section>

        {view === 'citizen' && <>
          <section className={`status-card ${suspended ? 'danger' : ''}`}>
            <div className="status-copy">
              <span className="live-dot"></span><span className="eyebrow">{suspended ? 'RUTA SUSPENDIDA' : 'ESTADO EN VIVO'}</span>
              <h2>{suspended ? 'La unidad reportó una avería' : routeActive ? 'El camión está en camino' : 'Próxima ruta programada'}</h2>
              <p>{suspended ? 'Te avisaremos cuando el servicio se reanude.' : routeActive ? 'Consulta su posición actual en el mapa.' : 'El seguimiento aparecerá cuando el chofer inicie.'}</p>
              <div className="eta"><b>{suspended ? '—' : routeActive ? 'GPS' : routePlan.day.slice(0, 3)}</b><span>{suspended ? 'Sin hora estimada' : routeActive ? 'ubicación en vivo' : routePlan.time}</span></div>
            </div>
            <div className="map-card"><LiveMap truckPosition={truckPosition} suspended={suspended} reports={reports} routePoints={routePoints} /><div className="map-key"><span></span>{nearbyDistance !== null ? `Camión a ${nearbyDistance} m` : suspended ? 'Unidad detenida' : routeActive ? 'Ubicación en vivo' : 'Ruta programada'}</div></div>
          </section>
          <section className="quick-grid">
            <button className="action-card report" onClick={() => setReportOpen(true)}><span className="icon">⚑</span><span><b>Reportar basura</b><small>{reports.filter((item) => item.status === 'open').length ? `${reports.filter((item) => item.status === 'open').length} punto(s) pendiente(s)` : 'Marca un punto crítico'}</small></span><i>›</i></button>
            <button className="action-card alerts" onClick={requestAlerts}><span className="icon">♢</span><span><b>{alertsEnabled ? 'Alertas activadas' : 'Activar alertas'}</b><small>{alertsEnabled ? 'Recibirás cambios de la ruta' : 'Avisos del recorrido y servicio'}</small></span><i>›</i></button>
          </section>
          {!user && <button className="staff-access" onClick={() => setAuthOpen(true)}>
            <span>🚛</span><span><b>¿Eres chofer o personal de la delegación?</b><small>Inicia sesión para abrir tu panel de trabajo.</small></span><i>Acceder →</i>
          </button>}
          <section className="notices">
            <div className="section-title"><div><span className="eyebrow">COMUNICADOS</span><h2>Últimas actualizaciones</h2></div><span className="record-count">{feed.length} avisos</span></div>
            {feed.slice(0, 5).map((notice) => <article key={notice.id}><div className="notice-icon">✓</div><div><small>{notice.date}</small><h3>{notice.title}</h3><p>{notice.text}</p></div></article>)}
          </section>
        </>}

        {view === 'driver' && user?.role === 'driver' && <section className="panel driver-panel">
          <span className="eyebrow">MODO OPERADOR</span><h2>Control de la ruta</h2><p>Comparte la ubicación del dispositivo con la comunidad durante el recorrido.</p>
          <form className="route-plan-form" onSubmit={updateRoutePlan}>
            <label>Día<select name="day" value={routePlan.day} onChange={(event) => setRoutePlan({ ...routePlan, day: event.target.value })}>{ROUTE_DAYS.map((day) => <option key={day}>{day}</option>)}</select></label>
            <label>Horario<input name="time" type="time" value={routePlan.time} onChange={(event) => setRoutePlan({ ...routePlan, time: event.target.value })} /></label>
            <label>Ruta<input name="name" value={routePlan.name} onChange={(event) => setRoutePlan({ ...routePlan, name: event.target.value })} placeholder="Ruta centro" /></label>
            <button>Guardar horario</button>
          </form>
          <div className="route-editor">
            <div className="route-editor-head">
              <div><h3>Trazar recorrido</h3><p>Toca el mapa para agregar paradas. Si entra un reporte, puedes sumarlo como desvío.</p></div>
              <span>{routePoints.length} paradas</span>
            </div>
            <div className="driver-map">
              <LiveMap truckPosition={truckPosition} suspended={suspended} reports={reports} routePoints={routePoints} editable onAddPoint={addRoutePoint} />
            </div>
            <div className="route-tools">
              <button onClick={undoRoutePoint}>Deshacer punto</button>
              <button onClick={resetRoutePoints}>Limpiar ruta</button>
            </div>
          </div>
          <div className={`driver-state ${routeActive ? 'on' : ''}`}><div className="big-truck">🚛</div><div><small>{gpsState === 'requesting' ? 'SOLICITANDO UBICACIÓN' : routeActive ? 'GPS ACTIVO' : gpsState === 'error' ? 'GPS NO DISPONIBLE' : 'UNIDAD SIN CONEXIÓN'}</small><b>{routeActive ? 'Ruta activa' : 'Ruta no iniciada'}</b><span>{routeActive ? coords : 'Pulsa el botón para comenzar'}</span></div></div>
          <button className="primary-button" onClick={routeActive ? stopGps : startGps} disabled={gpsState === 'requesting'}>{gpsState === 'requesting' ? 'Esperando permiso…' : routeActive ? 'Finalizar ruta' : 'Iniciar ruta y compartir GPS'}</button>
          <label className="failure-label">Falla o incidencia<textarea value={failureText} onChange={(event) => setFailureText(event.target.value)} maxLength="160" placeholder="Ej. Ponchadura, falla mecánica, retraso por tráfico" /></label>
          <button className="breakdown-button" disabled={!routeActive} onClick={reportBreakdown}>⚠ Reportar avería mecánica</button>
          <p className="privacy-note">🔒 La ubicación se usa únicamente mientras la ruta está activa.</p>
          <ReportQueue reports={reports} onStatus={changeReportStatus} onAddStop={addReportToRoute} />
        </section>}

        {view === 'admin' && user?.role === 'admin' && <section className="panel admin-panel">
          <span className="eyebrow">PANEL DEL DELEGADO</span><h2>Administración del servicio</h2><p>Publica comunicados y administra el acceso del personal.</p>

          <div className="admin-block">
            <h3>Aviso extraordinario</h3>
            <label htmlFor="message">Mensaje para la comunidad</label><textarea id="message" defaultValue="La ruta presenta un retraso. Compartiremos una nueva hora estimada en breve." />
            <div className="admin-summary"><span>Destinatarios</span><b>Comunidad de Pueblo Nuevo Jasso</b><small>Disponible en el historial de comunicados</small></div>
            <button className="primary-button" onClick={sendNotice}>Publicar aviso</button>
          </div>

          <div className="admin-block">
            <h3>Crear cuenta de personal</h3>
            <p>El correo y la contraseña funcionarán tanto en la web como en el APK.</p>
            <form className="staff-form" onSubmit={createStaff}>
              <label>Nombre completo<input name="name" required minLength="2" placeholder="Nombre del responsable" /></label>
              <label>Correo electrónico<input name="email" type="email" required placeholder="chofer@correo.com" /></label>
              <label>Contraseña temporal<input name="password" type="password" required minLength="6" placeholder="Mínimo 6 caracteres" /></label>
              <label>Tipo de acceso<select name="role" defaultValue="driver"><option value="driver">Chofer</option><option value="admin">Delegación</option></select></label>
              <button className="primary-button" disabled={creatingStaff}>{creatingStaff ? 'Creando cuenta…' : 'Crear cuenta'}</button>
            </form>
          </div>

          <div className="admin-block">
            <div className="staff-list-title"><h3>Cuentas registradas</h3><span>{users.length}</span></div>
            <div className="staff-list">
              {users.map((account) => <article key={account.id}><div className={`role-badge ${account.role}`}>{account.role === 'admin' ? 'DE' : account.role === 'driver' ? 'CH' : 'CI'}</div><div><b>{account.name}</b><small>{account.email}</small></div><span>{account.role === 'admin' ? 'Delegación' : account.role === 'driver' ? 'Chofer' : 'Ciudadano'}</span></article>)}
            </div>
          </div>

          <div className="admin-block">
            <ReportQueue reports={reports} onStatus={changeReportStatus} />
          </div>
        </section>}
      </main>
      <footer><span>Ruta Limpia · Prototipo académico PWA</span><span>Universidad Tecnológica de Tula-Tepeji · 2026</span></footer>
    </div>
  )
}

export default App
