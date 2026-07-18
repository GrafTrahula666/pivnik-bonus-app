import compression from 'compression';
import express from 'express';
import helmet from 'helmet';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = Number(process.env.PORT || 3000);

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    })
  : null;

app.get('/api/health', async (_req, res) => {
  let database = 'not-configured';

  if (pool) {
    try {
      await pool.query('select 1');
      database = 'ok';
    } catch (error) {
      database = 'error';
      console.error('Database health check failed:', error.message);
    }
  }

  res.status(database === 'error' ? 503 : 200).json({
    ok: database !== 'error',
    service: 'pivnik-bonus-app',
    database,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/config', (_req, res) => {
  res.json({
    appName: 'Пивник | Бонусы',
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/styles.css', (_req, res) => res.sendFile(path.join(__dirname, 'styles.css')));
app.get('/app.js', (_req, res) => res.sendFile(path.join(__dirname, 'app.js')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Pivnik app is running on port ${port}`);
});

async function shutdown(signal) {
  console.log(`${signal}: shutting down`);
  server.close(async () => {
    if (pool) await pool.end();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
