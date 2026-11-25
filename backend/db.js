const { Pool } = require('pg');
const Redis = require('ioredis');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.query('SELECT NOW()')
  .then(() => console.log('✅ PostgreSQL (Neon) Connected'))
  .catch((err) => console.error('❌ PostgreSQL Error:', err.message));

const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  tls: { rejectUnauthorized: false }
});

redis.on('connect', () => console.log('✅ Redis (Upstash) Connected'));
redis.on('error', (err) => console.error('❌ Redis Error:', err.message));

module.exports = { pool, redis };