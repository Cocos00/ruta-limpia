import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright-core'

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const apiUrl = 'http://127.0.0.1:4000/api'
const outputDir = path.resolve('demo-recordings')

const users = {
  citizen: { email: 'ciudadano.demo@rutalimpia.local', password: 'demo1234' },
  driver: { email: 'chofer.demo@rutalimpia.local', password: 'demo1234' },
  admin: { email: 'admin@rutalimpia.local', password: 'cambia123' },
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
    body: JSON.stringify(user),
  })
  return payload.token
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true })

  const tokens = {
    citizen: await login(users.citizen),
    driver: await login(users.driver),
    admin: await login(users.admin),
  }

  await api('/routes/current', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tokens.driver}` },
    body: JSON.stringify({
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
    }),
  })

  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
  })
  const context = await browser.newContext({
    viewport: { width: 1500, height: 940 },
    recordVideo: {
      dir: outputDir,
      size: { width: 1500, height: 940 },
    },
  })

  const page = await context.newPage()
  await page.setContent(`
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <title>Ruta Limpia Demo</title>
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            min-height: 100vh;
            background: radial-gradient(circle at 12% 0%, rgba(252,76,2,.38), transparent 310px), radial-gradient(circle at 90% 18%, rgba(255,255,255,.14), transparent 280px), #101010;
            color: white;
            font-family: Inter, "Segoe UI", Arial, sans-serif;
          }
          header {
            height: 92px;
            padding: 0 30px;
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
          h1 { margin: 0; font-size: 29px; letter-spacing: -.04em; }
          #caption {
            width: min(760px, 58vw);
            padding: 14px 18px;
            border: 1px solid rgba(255,255,255,.28);
            border-radius: 999px;
            background: rgba(255,255,255,.12);
            backdrop-filter: blur(22px) saturate(1.4);
            font-weight: 850;
            box-shadow: inset 0 1px rgba(255,255,255,.28), 0 14px 48px rgba(0,0,0,.22);
          }
          main {
            height: calc(100vh - 92px);
            padding: 0 24px 24px;
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 18px;
          }
          .phone {
            overflow: hidden;
            border-radius: 28px;
            border: 1px solid rgba(255,255,255,.22);
            background: #f7f7f4;
            color: #111;
            box-shadow: 0 28px 90px rgba(0,0,0,.36);
          }
          .top {
            padding: 20px 20px 14px;
            color: white;
            background: linear-gradient(135deg, #111 0%, #2b211d 100%);
          }
          .role {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 8px 11px;
            border-radius: 999px;
            background: rgba(255,255,255,.14);
            font-size: 11px;
            font-weight: 900;
            letter-spacing: .1em;
          }
          .dot { width: 8px; height: 8px; border-radius: 50%; background: #fc4c02; box-shadow: 0 0 0 6px rgba(252,76,2,.18); }
          .top h2 { margin: 22px 0 7px; font-size: 30px; line-height: .96; letter-spacing: -.05em; }
          .top p { margin: 0; color: rgba(255,255,255,.7); font-size: 13px; }
          .content { padding: 18px; display: grid; gap: 13px; }
          .metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
          .card {
            padding: 15px;
            border: 1px solid #e6e2dc;
            border-radius: 12px;
            background: white;
            box-shadow: 0 8px 24px rgba(17,17,17,.05);
          }
          .card span, .feed small { display: block; color: #777; font-size: 10px; font-weight: 850; text-transform: uppercase; letter-spacing: .07em; }
          .card b { display: block; margin-top: 5px; font-size: 19px; line-height: 1.05; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          button {
            border: 0;
            border-radius: 999px;
            padding: 13px 16px;
            background: #fc4c02;
            color: white;
            font-weight: 900;
            box-shadow: 0 13px 26px rgba(252,76,2,.22);
          }
          button.secondary { background: #111; box-shadow: 0 13px 26px rgba(17,17,17,.18); }
          .feed { display: grid; gap: 9px; max-height: 220px; overflow: hidden; }
          .feed article {
            padding: 12px;
            border: 1px solid #e6e2dc;
            border-radius: 12px;
            background: white;
          }
          .feed h3 { margin: 4px 0 3px; font-size: 14px; }
          .feed p { margin: 0; color: #666; font-size: 12px; line-height: 1.32; }
          .map {
            height: 164px;
            position: relative;
            overflow: hidden;
            border-radius: 14px;
            background:
              linear-gradient(35deg, transparent 44%, rgba(252,76,2,.58) 45%, rgba(252,76,2,.58) 48%, transparent 49%),
              linear-gradient(110deg, transparent 42%, rgba(17,17,17,.16) 43%, rgba(17,17,17,.16) 46%, transparent 47%),
              #dfe8da;
          }
          .truck, .report-pin {
            position: absolute;
            display: grid;
            place-items: center;
            width: 38px;
            height: 38px;
            border-radius: 50%;
            color: white;
            font-weight: 900;
            transform: translate(-50%, -50%);
            transition: left .7s ease, top .7s ease;
          }
          .truck { left: var(--truck-x, 34%); top: var(--truck-y, 62%); background: #111; box-shadow: 0 8px 24px rgba(17,17,17,.3); }
          .report-pin { left: 70%; top: 44%; background: #c93c2f; opacity: var(--report-visible, 0); }
          .glass-nav {
            display: grid;
            grid-template-columns: repeat(3,1fr);
            gap: 5px;
            padding: 8px;
            border-radius: 999px;
            background: rgba(255,255,255,.58);
            border: 1px solid rgba(255,255,255,.7);
            backdrop-filter: blur(20px);
          }
          .glass-nav i {
            display: grid;
            place-items: center;
            min-height: 42px;
            border-radius: 999px;
            font-style: normal;
            font-weight: 900;
            color: #555;
          }
          .glass-nav i.active { background: #111; color: white; }
          .status-live { color: #fc4c02; }
        </style>
      </head>
      <body>
        <header>
          <h1>Ruta Limpia - Demo de funcionamiento</h1>
          <div id="caption">Tres roles conectados a la misma API y base MongoDB.</div>
        </header>
        <main>
          <section class="phone" id="citizen">
            <div class="top"><div class="role"><i class="dot"></i>USUARIO</div><h2>Comunidad</h2><p>Consulta ruta, reporta basura y recibe avisos.</p></div>
            <div class="content">
              <div class="metric-grid">
                <div class="card"><span>Estado</span><b data-route-status>Programada</b></div>
                <div class="card"><span>Horario</span><b data-route-time>08:00</b></div>
                <div class="card"><span>Ruta</span><b data-route-name>Ruta centro</b></div>
                <div class="card"><span>Reportes</span><b data-report-count>0</b></div>
              </div>
              <div class="map"><div class="truck">🚛</div><div class="report-pin">!</div></div>
              <button id="citizenReport">Reportar punto crítico</button>
              <div class="feed" data-feed></div>
              <div class="glass-nav"><i class="active">Inicio</i><i>Reportar</i><i>Perfil</i></div>
            </div>
          </section>
          <section class="phone" id="driver">
            <div class="top"><div class="role"><i class="dot"></i>CHOFER</div><h2>Mi ruta</h2><p>Define horario, comparte GPS y atiende reportes.</p></div>
            <div class="content">
              <div class="metric-grid">
                <div class="card"><span>Asignación</span><b data-route-time>08:00</b></div>
                <div class="card"><span>Paradas</span><b data-stop-count>4</b></div>
                <div class="card"><span>Reportes</span><b data-report-count>0</b></div>
                <div class="card"><span>GPS</span><b data-route-status>Inactiva</b></div>
              </div>
              <div class="map"><div class="truck">🚛</div><div class="report-pin">!</div></div>
              <button id="driverSchedule">Guardar horario</button>
              <button id="driverAttend" class="secondary">Sumar reporte a ruta</button>
              <button id="driverStart">Iniciar ruta GPS</button>
              <div class="feed" data-feed></div>
            </div>
          </section>
          <section class="phone" id="admin">
            <div class="top"><div class="role"><i class="dot"></i>DELEGACIÓN</div><h2>Panel</h2><p>Publica avisos y supervisa servicio.</p></div>
            <div class="content">
              <div class="metric-grid">
                <div class="card"><span>Base</span><b>MongoDB</b></div>
                <div class="card"><span>Usuarios</span><b>3 roles</b></div>
                <div class="card"><span>Estado</span><b data-route-status>Programada</b></div>
                <div class="card"><span>Reportes</span><b data-report-count>0</b></div>
              </div>
              <button id="adminNotice">Publicar aviso</button>
              <div class="feed" data-feed></div>
              <div class="glass-nav"><i>Inicio</i><i class="active">Panel</i><i>Perfil</i></div>
            </div>
          </section>
        </main>
        <script>
          const API = '${apiUrl}'
          const tokens = ${JSON.stringify(tokens)}
          const state = { route: {}, reports: [], notices: [] }
          const now = () => new Date().toISOString()
          async function request(path, options = {}) {
            const response = await fetch(API + path, {
              ...options,
              headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            })
            if (!response.ok) throw new Error(await response.text())
            return response.json()
          }
          async function refresh() {
            const [route, reports, notices] = await Promise.all([
              request('/routes/current'),
              request('/reports'),
              request('/notices'),
            ])
            state.route = route
            state.reports = reports
            state.notices = notices
            render()
          }
          function render() {
            const routeStatus = state.route.status === 'active' ? 'En vivo' : state.route.status === 'suspended' ? 'Pausada' : 'Programada'
            const openReports = state.reports.filter((report) => report.status !== 'resolved')
            document.querySelectorAll('[data-route-status]').forEach((el) => {
              el.textContent = routeStatus
              el.classList.toggle('status-live', state.route.status === 'active')
            })
            document.querySelectorAll('[data-route-time]').forEach((el) => { el.textContent = state.route.time || '08:00' })
            document.querySelectorAll('[data-route-name]').forEach((el) => { el.textContent = state.route.name || 'Ruta centro' })
            document.querySelectorAll('[data-report-count]').forEach((el) => { el.textContent = String(openReports.length) })
            document.querySelectorAll('[data-stop-count]').forEach((el) => { el.textContent = String((state.route.points || []).length) })
            document.body.style.setProperty('--report-visible', openReports.length ? '1' : '0')
            document.body.style.setProperty('--truck-x', state.route.status === 'active' ? '62%' : '34%')
            document.body.style.setProperty('--truck-y', state.route.status === 'active' ? '40%' : '62%')
            document.querySelectorAll('[data-feed]').forEach((feed) => {
              feed.innerHTML = state.notices.slice(0, 3).map((notice) => '<article><small>' + new Date(notice.createdAt || notice.date || Date.now()).toLocaleTimeString('es-MX') + '</small><h3>' + (notice.title || 'Aviso') + '</h3><p>' + (notice.text || '') + '</p></article>').join('')
            })
          }
          async function setCaption(text) {
            document.querySelector('#caption').textContent = text
          }
          document.querySelector('#driverSchedule').onclick = async () => {
            await setCaption('Chofer actualiza horario y ruta; usuario y delegación lo ven sincronizado.')
            await request('/routes/current', {
              method: 'PUT',
              headers: { Authorization: 'Bearer ' + tokens.driver },
              body: JSON.stringify({ ...state.route, status: 'inactive', day: 'Miércoles', time: '08:35', name: 'Ruta demo sincronizada', points: state.route.points || [] }),
            })
            await refresh()
          }
          document.querySelector('#adminNotice').onclick = async () => {
            await setCaption('Delegación publica un aviso; aparece en los paneles conectados.')
            await request('/notices', {
              method: 'POST',
              headers: { Authorization: 'Bearer ' + tokens.admin },
              body: JSON.stringify({ title: 'Aviso de delegación', text: 'La ruta demo queda activa y atenderá reportes ciudadanos.', type: 'notice', createdAt: now() }),
            })
            await refresh()
          }
          document.querySelector('#citizenReport').onclick = async () => {
            await setCaption('Usuario reporta basura con ubicación; chofer y delegación reciben el punto.')
            await request('/reports', {
              method: 'POST',
              body: JSON.stringify({ lat: 20.0558, lng: -99.2782, category: 'Basura acumulada', details: 'Punto crítico reportado durante la demo.', status: 'open', createdAt: now() }),
            })
            await refresh()
          }
          document.querySelector('#driverAttend').onclick = async () => {
            await setCaption('Chofer toma el reporte y lo suma como desvío de la ruta.')
            const report = state.reports.find((item) => item.status !== 'resolved')
            const points = [...(state.route.points || [])]
            if (report) {
              points.push([Number(report.lat), Number(report.lng)])
              await request('/reports/' + report.id, {
                method: 'PATCH',
                headers: { Authorization: 'Bearer ' + tokens.driver },
                body: JSON.stringify({ status: 'attending' }),
              })
            }
            await request('/routes/current', {
              method: 'PUT',
              headers: { Authorization: 'Bearer ' + tokens.driver },
              body: JSON.stringify({ ...state.route, points }),
            })
            await refresh()
          }
          document.querySelector('#driverStart').onclick = async () => {
            await setCaption('Chofer inicia GPS; el estado cambia a ruta en vivo para todos.')
            await request('/routes/current', {
              method: 'PUT',
              headers: { Authorization: 'Bearer ' + tokens.driver },
              body: JSON.stringify({ ...state.route, status: 'active', lat: 20.0558, lng: -99.2782 }),
            })
            await refresh()
          }
          refresh()
          setInterval(refresh, 1800)
        </script>
      </body>
    </html>
  `)

  await page.waitForTimeout(2500)
  await page.locator('#driverSchedule').click()
  await page.waitForTimeout(3500)
  await page.locator('#adminNotice').click()
  await page.waitForTimeout(3500)
  await page.locator('#citizenReport').click()
  await page.waitForTimeout(3500)
  await page.locator('#driverAttend').click()
  await page.waitForTimeout(3500)
  await page.locator('#driverStart').click()
  await page.waitForTimeout(5500)
  await page.evaluate(() => { document.querySelector('#caption').textContent = 'Demo finalizada: tres roles sincronizados en tiempo real con MongoDB.' })
  await page.waitForTimeout(2500)

  const video = page.video()
  await context.close()
  await browser.close()
  const videoPath = await video.path()
  const finalPath = path.join(outputDir, 'ruta-limpia-demo-3-roles.webm')
  await fs.copyFile(videoPath, finalPath)
  console.log(finalPath)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
