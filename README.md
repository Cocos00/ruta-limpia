# Ruta Limpia

PWA para rastreo y sincronizacion de rutas de recoleccion de residuos en Pueblo
Nuevo Jasso. Incluye vistas para ciudadano, chofer y delegado.

## Ejecutar en VS Code

Instala dependencias:

```bash
npm install
```

Levanta la API en una terminal:

```bash
npm run api
```

Levanta la app en otra terminal:

```bash
npm run dev
```

Abre la URL de Vite, normalmente `http://localhost:5173`.

## MongoDB local con Docker

Para desarrollar sin depender de Atlas, inicia una base de datos local:

```bash
npm run db:up
```

En `.env.local` usa una URI local (no subas este archivo):

```env
MONGODB_URI=mongodb://127.0.0.1:27017/ruta_limpia
MONGODB_DB=ruta_limpia
SESSION_SECRET=usa-un-secreto-largo-y-unico
```

Después inicia la API con `npm run api`. Para detener el contenedor usa
`npm run db:down`; los datos se conservan en el volumen de Docker. Puedes ver
los registros con `npm run db:logs`.

## Base de datos NoSQL

La app usa MongoDB Atlas mediante una API Node/Express local. MongoDB Atlas tiene
un plan gratuito que sirve para pruebas y demos pequenas.

1. Crea un cluster gratuito en MongoDB Atlas.
2. Crea un usuario de base de datos.
3. Permite tu IP en Network Access.
4. Copia `.env.example` como `.env.local`.
5. Completa `MONGODB_URI`, `MONGODB_DB` y `SESSION_SECRET`.
6. Define `FIRST_ADMIN_EMAIL` y `FIRST_ADMIN_PASSWORD` para crear el primer
   delegado automaticamente cuando arranque `npm run api`.

Si `MONGODB_URI` no esta configurado, la app conserva modo demo con
`localStorage`, pero el login real necesita la API con MongoDB.

## Colecciones

- `routes`: estado actual de la unidad, ubicacion GPS, dia, horario, ruta y falla.
- `notices`: comunicados para usuarios, cambios de horario e incidencias.
- `reports`: puntos criticos reportados por ciudadanos.
- `users`: cuentas y roles (`citizen`, `driver` o `admin`).

## Flujo de roles

- Ciudadano: consulta ruta, activa alertas y reporta basura.
- Chofer: asigna dia, horario y ruta; comparte GPS; reporta fallas.
- Delegacion: publica avisos, crea cuentas de chofer/delegacion y da seguimiento.

Los cambios de horario y fallas crean avisos. Los usuarios que tengan alertas
activadas reciben notificaciones locales cuando la app esta instalada o abierta.

## Verificacion

```bash
npm run lint
npm run build
```
