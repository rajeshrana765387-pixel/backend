const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('⚠️ WARNING: DATABASE_URL is not defined in environment variables.');
}

// Check whether SSL should be enabled:
// Cloud providers and shared poolers (Supabase, Neon, Render, Railway, AWS RDS, etc.) require SSL.
const isExplicitLocalhost = Boolean(
  connectionString &&
  (connectionString.includes('localhost') || connectionString.includes('127.0.0.1')) &&
  !connectionString.includes('sslmode=require')
);

const shouldEnableSSL =
  process.env.DATABASE_SSL === 'true' ||
  process.env.NODE_ENV === 'production' ||
  (!isExplicitLocalhost && Boolean(connectionString));

const pool = new Pool({
  connectionString,
  ssl: shouldEnableSSL ? { rejectUnauthorized: false } : false,
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('connect', () => {
  // Successfully established a client connection
});

// IMPORTANT FOR SHARED POOLERS (PgBouncer / Supabase / Neon / Render):
// Shared poolers routinely terminate idle connections on their end.
// DO NOT call process.exit(-1) here, or the entire web server will crash.
pool.on('error', (err) => {
  console.warn('⚠️ PostgreSQL Pool idle connection warning (managed by pooler):', err.message);
});

module.exports = pool;
