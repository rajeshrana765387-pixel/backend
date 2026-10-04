const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { ratingValidator } = require('../middleware/validators');

const router = express.Router();

// POST /api/ratings - Submit a rating for a store
router.post('/', authenticate, authorize('user'), ratingValidator, async (req, res, next) => {
  try {
    const { store_id, rating } = req.body;

    // Check store exists
    const storeCheck = await pool.query('SELECT id FROM stores WHERE id = $1', [store_id]);
    if (storeCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Store not found' });
    }

    // Check if user already rated this store
    const existingRating = await pool.query(
      'SELECT id FROM ratings WHERE store_id = $1 AND user_id = $2',
      [store_id, req.user.id]
    );

    if (existingRating.rows.length > 0) {
      return res.status(409).json({ message: 'You have already rated this store. Use PUT to update.' });
    }

    const result = await pool.query(
      `INSERT INTO ratings (store_id, user_id, rating)
       VALUES ($1, $2, $3)
       RETURNING id, store_id, user_id, rating, created_at`,
      [store_id, req.user.id, rating]
    );

    res.status(201).json({ message: 'Rating submitted successfully', rating: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// PUT /api/ratings/:storeId - Update existing rating
router.put('/:storeId', authenticate, authorize('user'), ratingValidator, async (req, res, next) => {
  try {
    const { storeId } = req.params;
    const { rating } = req.body;

    const result = await pool.query(
      `UPDATE ratings SET rating = $1
       WHERE store_id = $2 AND user_id = $3
       RETURNING id, store_id, user_id, rating, updated_at`,
      [rating, storeId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Rating not found. Submit a rating first.' });
    }

    res.json({ message: 'Rating updated successfully', rating: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// GET /api/ratings/store/:storeId - Get all ratings for a store (admin)
router.get('/store/:storeId', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { storeId } = req.params;
    const result = await pool.query(
      `SELECT r.id, r.rating, r.created_at, r.updated_at,
              u.id as user_id, u.name as user_name, u.email as user_email
       FROM ratings r
       JOIN users u ON u.id = r.user_id
       WHERE r.store_id = $1
       ORDER BY r.updated_at DESC`,
      [storeId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
