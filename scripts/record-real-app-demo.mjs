import crypto from 'node:crypto'
import dns from 'node:dns'
import fs from 'node:fs/promises'
import path from 'node:path'
import dotenv from 'dotenv'
import { MongoClient } from 'mongodb'
import { chromium } from 'playwright-core'

dotenv.config({ path: '.env.local', quiet: true })

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const outputDir = path.resolve('demo-recordings')
const apiUrl = 'http://127.0.0.1:4000/api'
const urls = {
  citizen: 'http://127.0.0.1:5173',
  driver: 'http://127.0.0.1:5174',
  admin: 'http://127.0.0.1:5175',
}
const users = {
  citizen: { name: 'Ciudadano Demo', email: 'ciudadano.demo@rutalimpia.local', password: 'demo1234', role: 'citizen' },
  driver: { name: 'Chofer Demo', email: 'chofer.demo@rutalimpia.local', password: 'demo1234', role: 'driver' },
  admin: { name: 'Delegacion Demo', email: 'admin@rutalimpia.local', password: 'cambia123', role: 'admin' },
}

const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex')
  return `${salt}:${hash}`
}

async function api(pathname, options = {}) {
  const response = await fetch(`${apiUrl}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  if (!response.ok) throw new Error(`${pathname}: ${response.status} ${await response.text()}`)
  return response.json()
}

async function login(user) {
  const payload = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: user.email, password: user.password }),
  })
  return payload.token
}

async function seedDemoData() {
  const dnsServers = (process.env.DNS_SERVERS || '8.8.8.8,1.1.1.1').split(',').map((server) => server.trim()).filter(Boolean)
  if (dnsServers.length) dns.setServers(dnsServers)

  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 12000 })
  await client.connect()
  const db = client.db(process.env.MONGODB_DB || 'ruta_limpia')

  await db.collection('users').createIndex({ email: 1 }, { unique: true })
  for (const user of Object.values(users)) {
    await db.collection('users').updateOne(
      { email: user.email },
      {
        $set: {
          name: user.name,
          email: user.email,
          role: user.role,
          active: true,
          passwordHash: hashPassword(user.password),
          updatedAt: new Date().toISOString(),
        },
        $setOnInsert: { createdAt: new Date().toISOString() },
      },
      { upsert: true },
    )
  }

  await db.collection('routes').updateOne(
    { key: 'current' },
    {
      $set: {
        key: 'current',
        status: 'inactive',
        day: 'Martes',
        time: '08:00',
        name: 'Ruta centro',
        points: [
          [20.0572, -99.2812],
          [20.0551, -99.2787],
          [20.0535, -99.2754],
          [20.0518, -99.2729],
        ],
        updatedAt: new Date().toISOString(),
      },
    },
    { upsert: true },
  )

  await client.close()
}

async function newRolePage(browser, role, token) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 780 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    geolocation: { latitude: 20.0542, longitude: -99.2768 },
    permissions: ['geolocation', 'notifications'],
  })
  await context.addInitScript((value) => localStorage.setItem('ruta-limpia-token', value), token)
  await context.grantPermissions(['geolocation', 'notifications'], { origin: urls[role] })
  const page = await context.newPage()
  await page.goto(urls[role])
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(3500)
  return { context, page }
}

async function clickText(page, text) {
  await page.evaluate((value) => {
    const candidates = [...document.querySelectorAll('button, a, [role="button"]')]
    const target = candidates.find((element) => element.textContent?.includes(value))
    if (!target) throw new Error(`No se encontró "${value}"`)
    target.click()
  }, text)
  await page.waitForTimeout(900)
}

async function fillByLabel(page, labelText, value) {
  await page.evaluate(({ labelText: label, value: nextValue }) => {
    const labels = [...document.querySelectorAll('label')]
    const container = labels.find((item) => item.textContent?.includes(label))
    const field = container?.querySelector('input, textarea, select')
    if (!field) throw new Error(`No se encontró campo "${label}"`)
    field.value = nextValue
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
  }, { labelText, value })
  await page.waitForTimeout(400)
}

async function setRecorderCaption(page, text) {
  await page.evaluate((value) => { document.querySelector('#caption').textContent = value }, text)
}

async function scrollToSelector(page, selector) {
  await page.evaluate((value) => {
    const element = document.querySelector(value)
    if (element) element.scrollIntoView({ behavior: 'instant', block: 'center' })
  }, selector)
  await page.waitForTimeout(500)
}

async function scrollToText(page, text) {
  await page.evaluate((value) => {
    const elements = [...document.querySelectorAll('h1, h2, h3, button, article, .report-queue, .admin-block, .route-editor, .driver-state')]
    const element = elements.find((item) => item.textContent?.includes(value))
    if (element) element.scrollIntoView({ behavior: 'instant', block: 'center' })
  }, text)
  await page.waitForTimeout(500)
}

async function updateRecorder(recorder, rolePages) {
  const entries = await Promise.all(Object.entries(rolePages).map(async ([role, page]) => {
    const bytes = await page.screenshot({ type: 'jpeg', quality: 70 })
    return [role, Buffer.from(bytes).toString('base64')]
  }))
  await recorder.evaluate((items) => {
    for (const [role, image] of items) {
      const element = document.querySelector(`[data-role="${role}"] img`)
      element.src = `data:image/jpeg;base64,${image}`
    }
  }, entries)
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true })
  await seedDemoData()

  const tokens = {
    citizen: await login(users.citizen),
    driver: await login(users.driver),
    admin: await login(users.admin),
  }

  const browser = await chromium.launch({ executablePath: chromePath, headless: true })
  const citizen = await newRolePage(browser, 'citizen', tokens.citizen)
  const driver = await newRolePage(browser, 'driver', tokens.driver)
  const admin = await newRolePage(browser, 'admin', tokens.admin)

  const recorderContext = await browser.newContext({
    viewport: { width: 1500, height: 940 },
    recordVideo: {
      dir: outputDir,
      size: { width: 1500, height: 940 },
    },
  })
  const recorder = await recorderContext.newPage()
  await recorder.setContent(`
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <title>Ruta Limpia App Real</title>
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            color: white;
            background: radial-gradient(circle at 14% 0%, rgba(252,76,2,.34), transparent 310px), #101010;
            font-family: "Segoe UI", Arial, sans-serif;
          }
          header {
            height: 90px;
            padding: 0 28px;
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
          h1 { margin: 0; font-size: 28px; letter-spacing: -.04em; }
          #caption {
            width: min(750px, 58vw);
            padding: 14px 18px;
            border: 1px solid rgba(255,255,255,.28);
            border-radius: 999px;
            background: rgba(255,255,255,.12);
            backdrop-filter: blur(22px) saturate(1.35);
            font-weight: 850;
          }
          main {
            height: calc(100vh - 90px);
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
            padding: 0 26px 24px;
          }
          section {
            position: relative;
            overflow: hidden;
            border: 1px solid rgba(255,255,255,.24);
            border-radius: 30px;
            background: rgba(255,255,255,.08);
            box-shadow: 0 28px 90px rgba(0,0,0,.36);
          }
          .label {
            position: absolute;
            z-index: 2;
            left: 16px;
            top: 16px;
            padding: 9px 13px;
            border-radius: 999px;
            background: rgba(17,17,17,.82);
            border: 1px solid rgba(255,255,255,.22);
            font-size: 12px;
            font-weight: 900;
            letter-spacing: .08em;
          }
          img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            object-position: top center;
            background: white;
          }
        </style>
      </head>
      <body>
        <header>
          <h1>Ruta Limpia - app real en navegador</h1>
          <div id="caption">Cargando tres sesiones reales: usuario, chofer y delegación...</div>
        </header>
        <main>
          <section data-role="citizen"><div class="label">USUARIO</div><img /></section>
          <section data-role="driver"><div class="label">CHOFER</div><img /></section>
          <section data-role="admin"><div class="label">DELEGACIÓN</div><img /></section>
        </main>
      </body>
    </html>
  `)

  const rolePages = { citizen: citizen.page, driver: driver.page, admin: admin.page }
  let recording = true
  const captureLoop = async () => {
    while (recording) {
      await updateRecorder(recorder, rolePages).catch(() => {})
      await recorder.waitForTimeout(450)
    }
  }
  const loopPromise = captureLoop()

  await setRecorderCaption(recorder, '1. Usuario ve mapa, horario asignado y estado de la ruta en la app real.')
  await scrollToSelector(citizen.page, '.status-card')
  await scrollToSelector(driver.page, '.activity-strip')
  await scrollToSelector(admin.page, '.activity-strip')
  await recorder.waitForTimeout(3500)

  await setRecorderCaption(recorder, '2. Chofer abre "Mi ruta", cambia horario y nombre de ruta.')
  await clickText(driver.page, 'Mi ruta')
  await scrollToSelector(driver.page, '.route-plan-form')
  await fillByLabel(driver.page, 'Horario', '08:35')
  await fillByLabel(driver.page, 'Ruta', 'Ruta real con mapa')
  await clickText(driver.page, 'Guardar horario')
  await recorder.waitForTimeout(3500)

  await setRecorderCaption(recorder, '3. Chofer traza el recorrido tocando el mapa y agregando una parada.')
  await scrollToSelector(driver.page, '.route-editor')
  await driver.page.locator('.driver-map').click({ position: { x: 250, y: 135 } })
  await scrollToSelector(citizen.page, '.status-card')
  await recorder.waitForTimeout(4300)

  await setRecorderCaption(recorder, '4. Delegación publica un aviso desde el panel real.')
  await clickText(admin.page, 'Panel')
  await scrollToText(admin.page, 'Aviso extraordinario')
  await admin.page.locator('#message').fill('Demo real: la ruta queda activa y atenderá reportes ciudadanos.')
  await clickText(admin.page, 'Publicar aviso')
  await scrollToSelector(citizen.page, '.notices')
  await recorder.waitForTimeout(4200)

  await setRecorderCaption(recorder, '5. Delegación también tiene gestión de cuentas y reportes.')
  await scrollToText(admin.page, 'Crear cuenta de personal')
  await recorder.waitForTimeout(3200)

  await setRecorderCaption(recorder, '6. Usuario abre Reportar y envía un punto crítico con ubicación.')
  await clickText(citizen.page, 'Reportar')
  await fillByLabel(citizen.page, 'Descripción', 'Bolsas acumuladas en esquina principal.')
  await clickText(citizen.page, 'Enviar reporte')
  await scrollToSelector(citizen.page, '.status-card')
  await scrollToText(admin.page, 'Reportes ciudadanos')
  await recorder.waitForTimeout(5200)

  await setRecorderCaption(recorder, '7. Chofer ve el reporte ciudadano y lo suma como desvío.')
  await clickText(driver.page, 'Mi ruta')
  await scrollToText(driver.page, 'Reportes ciudadanos')
  await clickText(driver.page, 'Sumar a ruta').catch(() => {})
  await scrollToSelector(driver.page, '.route-editor')
  await scrollToSelector(citizen.page, '.status-card')
  await recorder.waitForTimeout(4300)

  await setRecorderCaption(recorder, '8. Chofer inicia GPS; usuario y delegación ven ubicación en vivo en el mapa.')
  await scrollToSelector(driver.page, '.driver-state')
  await driver.context.setGeolocation({ latitude: 20.0558, longitude: -99.2782 })
  await clickText(driver.page, 'Iniciar ruta y compartir GPS')
  await scrollToSelector(citizen.page, '.status-card')
  await scrollToSelector(admin.page, '.activity-strip')
  await recorder.waitForTimeout(6500)

  await setRecorderCaption(recorder, '9. Chofer reporta una falla; la ruta se suspende y se notifica como aviso.')
  await scrollToText(driver.page, 'Falla o incidencia')
  await fillByLabel(driver.page, 'Falla o incidencia', 'Falla mecánica durante recorrido demo.')
  await clickText(driver.page, 'Reportar avería mecánica')
  await scrollToSelector(citizen.page, '.status-card')
  await scrollToSelector(admin.page, '.notices')
  await recorder.waitForTimeout(6500)

  await setRecorderCaption(recorder, 'Demo finalizada: mapa, horarios, reportes, avisos, GPS y fallas sincronizados.')
  await recorder.waitForTimeout(2500)

  recording = false
  await loopPromise
  await updateRecorder(recorder, rolePages)

  const video = recorder.video()
  await recorderContext.close()
  await citizen.context.close()
  await driver.context.close()
  await admin.context.close()
  await browser.close()

  const videoPath = await video.path()
  const finalPath = path.join(outputDir, 'ruta-limpia-app-real-funciones-completas.webm')
  await fs.copyFile(videoPath, finalPath)
  console.log(finalPath)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
