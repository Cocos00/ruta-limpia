process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/ruta_limpia'
process.env.MONGODB_DB ||= 'ruta_limpia'

await import('./index.js')
