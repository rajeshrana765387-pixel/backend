const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { registerValidators, updatePasswordValidators } = require('../middleware/validators');

const router = express.Router();

// GET /api/users - Admin: get all users with filters and sorting
router.get('/', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { name, email, address, role, sortBy = 'name', sortOrder = 'ASC' } = req.query;

    const allowedSortFields = ['name', 'email', 'address', 'role', 'created_at'];
    const allowedSortOrders = ['ASC', 'DESC'];
    const safeSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'name';
    const safeSortOrder = allowedSortOrders.includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'ASC';

    let conditions = [];
    let params = [];
    let paramCount = 1;

    if (name) {
      conditions.push(`u.name ILIKE $${paramCount}`);
      params.push(`%${name}%`);
      paramCount++;
    }
    if (email) {
      conditions.push(`u.email ILIKE $${paramCount}`);
      params.push(`%${email}%`);
      paramCount++;
    }
    if (address) {
      conditions.push(`u.address ILIKE $${paramCount}`);
      params.push(`%${address}%`);
      paramCount++;
    }
    if (role) {
      conditions.push(`u.role = $${paramCount}`);
      params.push(role);
      paramCount++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT
        u.id, u.name, u.email, u.address, u.role, u.created_at,
        COALESCE(
          CASE WHEN u.role = 'store_owner' THEN (
            SELECT ROUND(AVG(r.rating)::numeric, 2)
            FROM stores s
            JOIN ratings r ON r.store_id = s.id
            WHERE s.owner_id = u.id
          ) END,
          NULL
        ) as store_rating
      FROM users u
      ${whereClause}
      ORDER BY u.${safeSortBy} ${safeSortOrder}
    `;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/users/stats - Admin: dashboard stats
router.get('/stats', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const [usersResult, storesResult, ratingsResult] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query('SELECT COUNT(*) FROM stores'),
      pool.query('SELECT COUNT(*) FROM ratings'),
    ]);

    res.json({
      totalUsers: parseInt(usersResult.rows[0].count),
      totalStores: parseInt(storesResult.rows[0].count),
      totalRatings: parseInt(ratingsResult.rows[0].count),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/users/me - Get current user profile
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, address, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/users/:id - Admin: get user details
router.get('/:id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT
        u.id, u.name, u.email, u.address, u.role, u.created_at,
        COALESCE(
          CASE WHEN u.role = 'store_owner' THEN (
            SELECT ROUND(AVG(r.rating)::numeric, 2)
            FROM stores s
            JOIN ratings r ON r.store_id = s.id
            WHERE s.owner_id = u.id
          ) END,
          NULL
        ) as store_rating
      FROM users u
      WHERE u.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/users - Admin: create new user (any role)
router.post('/', authenticate, authorize('admin'), registerValidators, async (req, res, next) => {
  try {
    const { name, email, password, address, role = 'user' } = req.body;

    const allowedRoles = ['admin', 'user', 'store_owner'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (name, email, password, address, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, address, role, created_at`,
      [name, email, hashedPassword, address, role]
    );

    res.status(201).json({ message: 'User created successfully', user: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/users/me/password - Update own password
router.patch('/me/password', authenticate, updatePasswordValidators, async (req, res, next) => {
  try {
    const { password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, req.user.id]);

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
