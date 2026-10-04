const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { registerValidators, loginValidators } = require('../middleware/validators');

const router = express.Router();

// POST /api/auth/register - Normal user registration
router.post('/register', registerValidators, async (req, res, next) => {
  try {
    const { name, email, password, address } = req.body;

    // Check if email already exists
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (name, email, password, address, role)
       VALUES ($1, $2, $3, $4, 'user')
       RETURNING id, name, email, address, role, created_at`,
      [name, email, hashedPassword, address]
    );

    const user = result.rows[0];
    const jwtSecret = process.env.JWT_SECRET || 'fallback_production_secret_key_change_me';
    const jwtExpires = process.env.JWT_EXPIRES_IN || '7d';
    const token = jwt.sign({ id: user.id, role: user.role }, jwtSecret, {
      expiresIn: jwtExpires,
    });

    res.status(201).json({ message: 'Registration successful', token, user });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', loginValidators, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      'SELECT id, name, email, password, role, address FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const jwtSecret = process.env.JWT_SECRET || 'fallback_production_secret_key_change_me';
    const jwtExpires = process.env.JWT_EXPIRES_IN || '7d';
    const token = jwt.sign({ id: user.id, role: user.role }, jwtSecret, {
      expiresIn: jwtExpires,
    });

    const { password: _, ...userWithoutPassword } = user;

    res.json({ message: 'Login successful', token, user: userWithoutPassword });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
