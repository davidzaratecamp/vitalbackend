import { createApp } from './app.js';
import { env } from './config/env.js';
import { db } from './db/knex.js';
import { arrancarTemporadaAutomatica } from './modules/renovaciones/renovaciones.service.js';

const app = createApp();

async function start() {
  try {
    await db.raw('select 1');
    console.log('Conexión a MySQL OK');
  } catch (err) {
    console.error('No se pudo conectar a MySQL:', err.message);
    process.exit(1);
  }

  const server = app.listen(env.port, () => {
    console.log(`Vital API escuchando en http://localhost:${env.port}`);
  });

  // Temporada de renovaciones: chequea al arrancar y cada 6 horas si hay
  // pólizas que les toca pasar a 'pendiente_renovacion' (el 1 de noviembre
  // de cada año). Es idempotente, así que repetir el chequeo no mueve nada
  // dos veces — y si el servidor estuvo caído justo ese día, al volver las
  // mueve igual. Ver renovaciones.service.js.
  arrancarTemporadaAutomatica();

  const shutdown = async () => {
    console.log('\nCerrando servidor...');
    server.close(async () => {
      await db.destroy();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
