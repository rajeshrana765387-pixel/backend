require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db/pool');
const { setupDatabase } = require('./db/setup');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const storeRoutes = require('./routes/stores');
const ratingRoutes = require('./routes/ratings');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Trust proxy for reverse proxies in production (Render, Heroku, Railway, Fly.io)
app.set('trust proxy', 1);

// Flexible Production CORS Configuration
const frontendOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map((s) => s.trim().replace(/\/$/, ''))
  : [];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, server-to-server, curl)
      if (!origin) return callback(null, true);

      // In non-production, allow all
      if (process.env.NODE_ENV !== 'production') return callback(null, true);

      // Check if origin is in FRONTEND_URL or is any Netlify deploy (*.netlify.app)
      const isAllowed =
        frontendOrigins.includes(origin) ||
        origin.endsWith('.netlify.app') ||
        origin.includes('localhost') ||
        origin.includes('127.0.0.1');

      if (isAllowed || frontendOrigins.length === 0) {
        return callback(null, true);
      }

      return callback(null, true); // Fallback to allow connection
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/stores', storeRoutes);
app.use('/api/ratings', ratingRoutes);

// Health check with DB status
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      status: 'degraded',
      database: 'disconnected',
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Global error handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

// Initialize server and test DB connection
const startServer = async () => {
  try {
    console.log('Testing PostgreSQL connection...');
    await pool.query('SELECT 1');
    console.log('✅ PostgreSQL connection successful.');

    // Auto-migrate tables if AUTO_MIGRATE=true or if users table does not exist
    if (process.env.AUTO_MIGRATE === 'true') {
      console.log('AUTO_MIGRATE is true. Running database setup...');
      await setupDatabase(false);
    } else {
      // Check if database is initialized
      const checkTables = await pool.query(
        "SELECT to_regclass('public.users') as exists"
      );
      if (!checkTables.rows[0].exists) {
        console.log('ℹ️ Database tables not detected. Initializing database schema automatically...');
        await setupDatabase(false);
      }
    }
  } catch (err) {
    console.error('⚠️ Database connection warning:', err.message);
    console.log('Server will continue running. Check your DATABASE_URL environment variable.');
  }

  const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });

  // Graceful shutdown
  const gracefulShutdown = () => {
    console.log('Shutting down server gracefully...');
    server.close(() => {
      pool.end(() => {
        console.log('PostgreSQL pool closed.');
        process.exit(0);
      });
    });
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
};

startServer();

module.exports = app;
