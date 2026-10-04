const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { storeValidators } = require('../middleware/validators');

const router = express.Router();

// GET /api/stores - Get all stores (with optional search and user rating)
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { name, address, sortBy = 'name', sortOrder = 'ASC' } = req.query;

    const allowedSortFields = ['name', 'email', 'address', 'average_rating'];
    const allowedSortOrders = ['ASC', 'DESC'];
    const safeSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'name';
    const safeSortOrder = allowedSortOrders.includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'ASC';

    let conditions = [];
    let params = [req.user.id];
    let paramCount = 2;

    if (name) {
      conditions.push(`s.name ILIKE $${paramCount}`);
      params.push(`%${name}%`);
      paramCount++;
    }
    if (address) {
      conditions.push(`s.address ILIKE $${paramCount}`);
      params.push(`%${address}%`);
      paramCount++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT
        s.id,
        s.name,
        s.email,
        s.address,
        s.owner_id,
        ROUND(AVG(r.rating)::numeric, 2) as average_rating,
        COUNT(r.id) as total_ratings,
        ur.rating as user_rating
      FROM stores s
      LEFT JOIN ratings r ON r.store_id = s.id
      LEFT JOIN ratings ur ON ur.store_id = s.id AND ur.user_id = $1
      ${whereClause}
      GROUP BY s.id, s.name, s.email, s.address, s.owner_id, ur.rating
      ORDER BY ${safeSortBy === 'average_rating' ? 'average_rating' : `s.${safeSortBy}`} ${safeSortOrder} NULLS LAST
    `;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/stores/my - Store owner: get their own store info
router.get('/my', authenticate, authorize('store_owner'), async (req, res, next) => {
  try {
    const storeResult = await pool.query(
      `SELECT
        s.id, s.name, s.email, s.address,
        ROUND(AVG(r.rating)::numeric, 2) as average_rating,
        COUNT(r.id) as total_ratings
       FROM stores s
       LEFT JOIN ratings r ON r.store_id = s.id
       WHERE s.owner_id = $1
       GROUP BY s.id, s.name, s.email, s.address`,
      [req.user.id]
    );

    if (storeResult.rows.length === 0) {
      return res.status(404).json({ message: 'No store found for this owner' });
    }

    const store = storeResult.rows[0];

    // Get list of users who rated the store
    const ratingsResult = await pool.query(
      `SELECT
        u.id, u.name, u.email,
        r.rating, r.created_at, r.updated_at
       FROM ratings r
       JOIN users u ON u.id = r.user_id
       WHERE r.store_id = $1
       ORDER BY r.updated_at DESC`,
      [store.id]
    );

    res.json({ store, ratings: ratingsResult.rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/stores/:id - Get single store
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT
        s.id, s.name, s.email, s.address, s.owner_id,
        ROUND(AVG(r.rating)::numeric, 2) as average_rating,
        COUNT(r.id) as total_ratings,
        ur.rating as user_rating
       FROM stores s
       LEFT JOIN ratings r ON r.store_id = s.id
       LEFT JOIN ratings ur ON ur.store_id = s.id AND ur.user_id = $2
       WHERE s.id = $1
       GROUP BY s.id, s.name, s.email, s.address, s.owner_id, ur.rating`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Store not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/stores - Admin: create new store
router.post('/', authenticate, authorize('admin'), storeValidators, async (req, res, next) => {
  try {
    const { name, email, address, owner_id } = req.body;

    // If owner_id provided, verify they are a store_owner
    if (owner_id) {
      const ownerCheck = await pool.query(
        "SELECT id FROM users WHERE id = $1 AND role = 'store_owner'",
        [owner_id]
      );
      if (ownerCheck.rows.length === 0) {
        return res.status(400).json({ message: 'Owner must be a user with store_owner role' });
      }
    }

    const result = await pool.query(
      `INSERT INTO stores (name, email, address, owner_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, address, owner_id, created_at`,
      [name, email, address, owner_id || null]
    );

    res.status(201).json({ message: 'Store created successfully', store: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// Admin: get stores list with average rating
router.get('/admin/list', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { name, email, address, sortBy = 'name', sortOrder = 'ASC' } = req.query;

    const allowedSortFields = ['name', 'email', 'address', 'average_rating'];
    const allowedSortOrders = ['ASC', 'DESC'];
    const safeSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'name';
    const safeSortOrder = allowedSortOrders.includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'ASC';

    let conditions = [];
    let params = [];
    let paramCount = 1;

    if (name) {
      conditions.push(`s.name ILIKE $${paramCount}`);
      params.push(`%${name}%`);
      paramCount++;
    }
    if (email) {
      conditions.push(`s.email ILIKE $${paramCount}`);
      params.push(`%${email}%`);
      paramCount++;
    }
    if (address) {
      conditions.push(`s.address ILIKE $${paramCount}`);
      params.push(`%${address}%`);
      paramCount++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT
        s.id, s.name, s.email, s.address, s.owner_id,
        u.name as owner_name,
        ROUND(AVG(r.rating)::numeric, 2) as average_rating,
        COUNT(r.id) as total_ratings
      FROM stores s
      LEFT JOIN users u ON u.id = s.owner_id
      LEFT JOIN ratings r ON r.store_id = s.id
      ${whereClause}
      GROUP BY s.id, s.name, s.email, s.address, s.owner_id, u.name
      ORDER BY ${safeSortBy === 'average_rating' ? 'average_rating' : `s.${safeSortBy}`} ${safeSortOrder} NULLS LAST
    `;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
