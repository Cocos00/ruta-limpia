import crypto from 'node:crypto'
import dns from 'node:dns'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import { MongoClient, ObjectId } from 'mongodb'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

const PORT = Number(process.env.PORT || 4000)
const rawMongoUri = process.env.MONGODB_URI?.trim()
const MONGODB_URI = rawMongoUri && !rawMongoUri.includes('usuario:password')
  ? rawMongoUri
  : ''
const DB_NAME = process.env.MONGODB_DB || 'ruta_limpia'
const TOKEN_SECRET = process.env.SESSION_SECRET || 'ruta-limpia-dev-secret'
const DNS_SERVERS = (process.env.DNS_SERVERS || '8.8.8.8,1.1.1.1').split(',').map((server) => server.trim()).filter(Boolean)
const MONGODB_SERVER_SELECTION_TIMEOUT_MS = Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 8000)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distPath = path.resolve(__dirname, '..', 'dist')

if (DNS_SERVERS.length) dns.setServers(DNS_SERVERS)

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

let db
let mongoClient
let dbStatus = MONGODB_URI ? 'connecting' : 'not-configured'
let dbError = ''
let databaseInitialization

const publicUser = (user) => user && ({
  id: String(user._id),
  uid: String(user._id),
  name: user.name,
  email: user.email,
  role: user.role || 'citizen',
  active: user.active !== false,
  createdAt: user.createdAt,
})

const normalizeDoc = (doc) => {
  if (!doc) return null
  const { _id, ...rest } = doc
  return { id: String(_id), ...rest }
}

const signToken = (payload) => {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = crypto.createHmac('sha256', TOKEN_SECRET).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

const verifyToken = (token) => {
  if (!token || !token.includes('.')) return null
  const [encoded, signature] = token.split('.')
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(encoded).digest('base64url')
  if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return null
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex')
  return `${salt}:${hash}`
}

const passwordMatches = (password, stored) => {
  const [salt] = String(stored || '').split(':')
  return hashPassword(password, salt) === stored
}

const requireDb = (request, response, next) => {
  if (!db) return response.status(503).json({ error: dbStatus === 'connection-error' ? 'MongoDB no está conectado. Revisa Network Access en Atlas o la URI.' : 'MongoDB no está configurado.' })
  next()
}

const requireUser = async (request, response, next) => {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '')
  const payload = verifyToken(token)
  if (!payload?.uid) return response.status(401).json({ error: 'Inicia sesion.' })
  const user = await db.collection('users').findOne({ _id: new ObjectId(payload.uid), active: { $ne: false } })
  if (!user) return response.status(401).json({ error: 'Sesion invalida.' })
  request.user = user
  next()
}

const requireStaff = (request, response, next) => {
  if (!['driver', 'admin'].includes(request.user?.role)) return response.status(403).json({ error: 'Acceso de personal requerido.' })
  next()
}

const requireAdmin = (request, response, next) => {
  if (request.user?.role !== 'admin') return response.status(403).json({ error: 'Acceso de delegacion requerido.' })
  next()
}

async function seedFirstAdmin() {
  const email = process.env.FIRST_ADMIN_EMAIL?.toLowerCase()
  const password = process.env.FIRST_ADMIN_PASSWORD
  if (!email || !password) return
  const users = db.collection('users')
  const hasAdmin = await users.findOne({ role: 'admin' })
  if (hasAdmin) return
  await users.insertOne({
    name: process.env.FIRST_ADMIN_NAME || 'Delegacion',
    email,
    passwordHash: hashPassword(password),
    role: 'admin',
    active: true,
    createdAt: new Date().toISOString(),
  })
  console.log(`Primer admin creado: ${email}`)
}

async function connectDatabase() {
  if (!MONGODB_URI) {
    dbStatus = 'not-configured'
    dbError = 'MONGODB_URI no configurado o es el ejemplo.'
    return
  }

  if (db) return

  if (!databaseInitialization) {
    databaseInitialization = (async () => {
      try {
        mongoClient = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: MONGODB_SERVER_SELECTION_TIMEOUT_MS })
        await mongoClient.connect()
        db = mongoClient.db(DB_NAME)
        await db.collection('users').createIndex({ email: 1 }, { unique: true })
        await seedFirstAdmin()
        dbStatus = 'mongodb'
        dbError = ''
        console.log(`MongoDB conectado: ${DB_NAME}`)
      } catch (error) {
        dbStatus = 'connection-error'
        dbError = error.code || error.message
        databaseInitialization = null
        await mongoClient?.close().catch(() => {})
        mongoClient = null
        console.warn(`No se pudo conectar a MongoDB (${error.code || error.message}). La API seguira en modo demo.`)
      }
    })()
  }

  await databaseInitialization
}

app.use(async (_request, _response, next) => {
  await connectDatabase()
  next()
})

app.get('/api/health', async (_request, response) => {
  if (db) {
    try {
      await db.command({ ping: 1 })
      dbStatus = 'mongodb'
      dbError = ''
    } catch (error) {
      dbStatus = 'connection-error'
      dbError = error.code || error.message
    }
  }
  response.json({
    ok: true,
    database: db && dbStatus === 'mongodb' ? 'mongodb' : dbStatus,
    error: dbStatus === 'mongodb' ? '' : dbError,
  })
})

app.post('/api/auth/register', requireDb, async (request, response) => {
  const { name, email, password } = request.body
  if (!name || !email || !password || password.length < 6) return response.status(400).json({ error: 'Datos de registro invalidos.' })
  const normalizedEmail = email.toLowerCase().trim()
  const exists = await db.collection('users').findOne({ email: normalizedEmail })
  if (exists) return response.status(409).json({ error: 'Ese correo ya tiene una cuenta.' })
  const result = await db.collection('users').insertOne({
    name: name.trim(),
    email: normalizedEmail,
    passwordHash: hashPassword(password),
    role: 'citizen',
    active: true,
    createdAt: new Date().toISOString(),
  })
  const user = await db.collection('users').findOne({ _id: result.insertedId })
  response.json({ user: publicUser(user), token: signToken({ uid: String(result.insertedId) }) })
})

app.post('/api/auth/login', requireDb, async (request, response) => {
  const { email, password } = request.body
  const user = await db.collection('users').findOne({ email: String(email || '').toLowerCase().trim(), active: { $ne: false } })
  if (!user || !passwordMatches(password, user.passwordHash)) return response.status(401).json({ error: 'Correo o contrasena incorrectos.' })
  response.json({ user: publicUser(user), token: signToken({ uid: String(user._id) }) })
})

app.get('/api/auth/session', requireDb, requireUser, (request, response) => {
  response.json({ user: publicUser(request.user) })
})

app.post('/api/auth/staff', requireDb, requireUser, requireAdmin, async (request, response) => {
  const { name, email, password, role } = request.body
  if (!['driver', 'admin'].includes(role)) return response.status(400).json({ error: 'Selecciona un rol valido.' })
  if (!name || !email || !password || password.length < 6) return response.status(400).json({ error: 'Datos de cuenta invalidos.' })
  const normalizedEmail = email.toLowerCase().trim()
  const exists = await db.collection('users').findOne({ email: normalizedEmail })
  if (exists) return response.status(409).json({ error: 'Ese correo ya tiene una cuenta.' })
  await db.collection('users').insertOne({
    name: name.trim(),
    email: normalizedEmail,
    passwordHash: hashPassword(password),
    role,
    active: true,
    createdBy: String(request.user._id),
    createdAt: new Date().toISOString(),
  })
  response.json({ ok: true })
})

app.get('/api/users', requireDb, requireUser, requireAdmin, async (_request, response) => {
  const users = await db.collection('users').find({}, { projection: { passwordHash: 0 } }).sort({ createdAt: -1 }).limit(100).toArray()
  response.json(users.map(publicUser))
})

app.get('/api/notices', requireDb, async (_request, response) => {
  const notices = await db.collection('notices').find().sort({ createdAt: -1 }).limit(20).toArray()
  response.json(notices.map(normalizeDoc))
})

app.post('/api/notices', requireDb, requireUser, requireStaff, async (request, response) => {
  const { title, text, type = 'notice' } = request.body
  if (!title || !text) return response.status(400).json({ error: 'Escribe el aviso antes de enviarlo.' })
  const result = await db.collection('notices').insertOne({
    title,
    text,
    type,
    createdBy: String(request.user._id),
    createdAt: new Date().toISOString(),
  })
  response.json(normalizeDoc(await db.collection('notices').findOne({ _id: result.insertedId })))
})

app.get('/api/reports', requireDb, async (_request, response) => {
  const reports = await db.collection('reports').find().sort({ createdAt: -1 }).limit(100).toArray()
  response.json(reports.map(normalizeDoc))
})

app.post('/api/reports', requireDb, async (request, response) => {
  const { lat, lng, category = 'Basura acumulada', details = '' } = request.body
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return response.status(400).json({ error: 'Ubicacion invalida.' })
  const result = await db.collection('reports').insertOne({
    lat,
    lng,
    category,
    details,
    status: 'open',
    createdBy: request.user ? String(request.user._id) : null,
    createdAt: new Date().toISOString(),
  })
  response.json(normalizeDoc(await db.collection('reports').findOne({ _id: result.insertedId })))
})

app.patch('/api/reports/:id', requireDb, requireUser, requireStaff, async (request, response) => {
  const { status } = request.body
  if (!['open', 'attending', 'resolved'].includes(status)) return response.status(400).json({ error: 'Estatus invalido.' })
  await db.collection('reports').updateOne({ _id: new ObjectId(request.params.id) }, {
    $set: { status, attendedBy: String(request.user._id), updatedAt: new Date().toISOString() },
  })
  response.json({ ok: true })
})

app.get('/api/routes/current', requireDb, async (_request, response) => {
  const route = await db.collection('routes').findOne({ key: 'current' })
  response.json(route ? normalizeDoc(route) : { status: 'inactive' })
})

app.put('/api/routes/current', requireDb, requireUser, requireStaff, async (request, response) => {
  const route = {
    ...request.body,
    key: 'current',
    updatedBy: String(request.user._id),
    updatedAt: new Date().toISOString(),
  }
  await db.collection('routes').updateOne({ key: 'current' }, { $set: route }, { upsert: true })
  response.json({ ok: true })
})

app.use(express.static(distPath))
app.get(/^(?!\/api).*/, (_request, response) => {
  response.sendFile(path.join(distPath, 'index.html'))
})

async function start() {
  await connectDatabase()
  app.listen(PORT, () => console.log(`API Ruta Limpia en http://localhost:${PORT}`))
}

if (!process.env.VERCEL) {
  start().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

const shutdown = async (signal) => {
  console.log(`${signal} recibido. Cerrando API Ruta Limpia...`)
  await mongoClient?.close().catch(() => {})
  process.exit(0)
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))

export default app
