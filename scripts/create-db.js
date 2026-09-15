import mysql from 'mysql2/promise';
import { env } from '../src/config/env.js';

async function main() {
  const conn = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
  });
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${env.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log(`Base de datos "${env.db.database}" lista.`);
  await conn.end();
}

main().catch((err) => {
  console.error('No se pudo crear la base de datos:', err.message);
  process.exit(1);
});
