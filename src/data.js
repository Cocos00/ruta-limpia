const API_URL = import.meta.env.VITE_API_URL || '/api'
const TOKEN_KEY = 'ruta-limpia-token'
const REPORTS_KEY = 'ruta-limpia-reports'
const NOTICES_KEY = 'ruta-limpia-notices'
const ROUTE_KEY = 'ruta-limpia-route'

export const cloudEnabled = true

const readLocal = (key, fallback) => JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback))
const writeLocal = (key, value) => {
  localStorage.setItem(key, JSON.stringify(value))
  window.dispatchEvent(new CustomEvent(`ruta-limpia:${key}`, { detail: value }))
}

const formatDate = (value) => {
  if (!value) return 'Ahora'
  return new Date(value).toLocaleString('es-MX')
}

const normalizeItems = (items) => items.map((item) => ({
  ...item,
  date: item.date || formatDate(item.createdAt),
}))

async function api(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY)
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'No se pudo conectar con la base de datos.')
  return payload
}

const poll = (load, callback, onError, fallbackLoad) => {
  let active = true
  const refresh = async () => {
    try {
      const items = await load()
      if (active) callback(items)
    } catch (error) {
      if (fallbackLoad && active) callback(fallbackLoad())
      onError?.(error)
    }
  }
  refresh()
  const timer = window.setInterval(refresh, 5000)
  return () => {
    active = false
    window.clearInterval(timer)
  }
}

export function observeSession(callback) {
  const refresh = () => {
    const currentToken = localStorage.getItem(TOKEN_KEY)
    if (!currentToken) return callback(null)
    return api('/auth/session')
      .then(({ user }) => callback(user))
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY)
        callback(null)
      })
  }
  window.addEventListener('ruta-limpia:auth', refresh)
  const token = localStorage.getItem(TOKEN_KEY)
  if (!token) {
    callback(null)
    return () => window.removeEventListener('ruta-limpia:auth', refresh)
  }
  let active = true
  api('/auth/session')
    .then(({ user }) => active && callback(user))
    .catch(() => {
      localStorage.removeItem(TOKEN_KEY)
      if (active) callback(null)
    })
  return () => {
    active = false
    window.removeEventListener('ruta-limpia:auth', refresh)
  }
}

export async function registerCitizen(values) {
  const { user, token } = await api('/auth/register', { method: 'POST', body: JSON.stringify(values) })
  localStorage.setItem(TOKEN_KEY, token)
  window.dispatchEvent(new Event('ruta-limpia:auth'))
  return user
}

export async function createStaffAccount(values) {
  await api('/auth/staff', { method: 'POST', body: JSON.stringify(values) })
}

export async function login(values) {
  const { user, token } = await api('/auth/login', { method: 'POST', body: JSON.stringify(values) })
  localStorage.setItem(TOKEN_KEY, token)
  window.dispatchEvent(new Event('ruta-limpia:auth'))
  return user
}

export async function logout() {
  localStorage.removeItem(TOKEN_KEY)
  window.dispatchEvent(new Event('ruta-limpia:auth'))
}

export function subscribeNotices(callback, onError) {
  const stopPolling = poll(
    () => api('/notices').then(normalizeItems),
    callback,
    onError,
    () => readLocal(NOTICES_KEY, []),
  )
  const refreshLocal = (event) => callback(event.detail)
  window.addEventListener(`ruta-limpia:${NOTICES_KEY}`, refreshLocal)
  return () => {
    stopPolling()
    window.removeEventListener(`ruta-limpia:${NOTICES_KEY}`, refreshLocal)
  }
}

export function subscribeReports(callback, onError) {
  const stopPolling = poll(
    () => api('/reports').then(normalizeItems),
    callback,
    onError,
    () => readLocal(REPORTS_KEY, []),
  )
  const refreshLocal = (event) => callback(event.detail)
  window.addEventListener(`ruta-limpia:${REPORTS_KEY}`, refreshLocal)
  return () => {
    stopPolling()
    window.removeEventListener(`ruta-limpia:${REPORTS_KEY}`, refreshLocal)
  }
}

export function subscribeRoute(callback, onError) {
  return poll(
    () => api('/routes/current'),
    callback,
    onError,
    () => readLocal(ROUTE_KEY, { status: 'inactive' }),
  )
}

export function subscribeUsers(callback, onError) {
  return poll(
    () => api('/users').then(normalizeItems),
    callback,
    onError,
    () => [],
  )
}

export async function saveNotice(notice) {
  try {
    await api('/notices', { method: 'POST', body: JSON.stringify(notice) })
    return true
  } catch {
    return false
  }
}

export async function saveReport(report) {
  try {
    await api('/reports', { method: 'POST', body: JSON.stringify(report) })
    return true
  } catch {
    return false
  }
}

export async function updateReportStatus(reportId, status) {
  try {
    await api(`/reports/${reportId}`, { method: 'PATCH', body: JSON.stringify({ status }) })
    return true
  } catch {
    const reports = readLocal(REPORTS_KEY, [])
    const next = reports.map((report) => report.id === reportId ? { ...report, status } : report)
    writeLocal(REPORTS_KEY, next)
    return true
  }
}

export async function saveRoute(route) {
  const next = { ...readLocal(ROUTE_KEY, { status: 'inactive' }), ...route }
  try {
    await api('/routes/current', { method: 'PUT', body: JSON.stringify(next) })
    return true
  } catch {
    writeLocal(ROUTE_KEY, next)
    return false
  }
}
