const pool = require('./pool');
const bcrypt = require('bcryptjs');

const setupDatabase = async (closePoolOnFinish = true) => {
  const client = await pool.connect();
  try {
    console.log('🔄 Setting up database tables and schemas...');
    await client.query('BEGIN');

    // Create enum for user roles
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE user_role AS ENUM ('admin', 'user', 'store_owner');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(60) NOT NULL CHECK (char_length(name) >= 20),
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        address VARCHAR(400),
        role user_role NOT NULL DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create stores table
    await client.query(`
      CREATE TABLE IF NOT EXISTS stores (
        id SERIAL PRIMARY KEY,
        name VARCHAR(60) NOT NULL CHECK (char_length(name) >= 20),
        email VARCHAR(255) UNIQUE NOT NULL,
        address VARCHAR(400),
        owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create ratings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ratings (
        id SERIAL PRIMARY KEY,
        store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(store_id, user_id)
      );
    `);

    // Create updated_at trigger function
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);

    // Apply trigger to users
    await client.query(`
      DROP TRIGGER IF EXISTS update_users_updated_at ON users;
      CREATE TRIGGER update_users_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    `);

    // Apply trigger to stores
    await client.query(`
      DROP TRIGGER IF EXISTS update_stores_updated_at ON stores;
      CREATE TRIGGER update_stores_updated_at
        BEFORE UPDATE ON stores
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    `);

    // Apply trigger to ratings
    await client.query(`
      DROP TRIGGER IF EXISTS update_ratings_updated_at ON ratings;
      CREATE TRIGGER update_ratings_updated_at
        BEFORE UPDATE ON ratings
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    `);

    // Seed default admin user (password: Admin@1234)
    const adminEmail = process.env.ADMIN_DEFAULT_EMAIL || 'admin@storerating.com';
    const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'Admin@1234';
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    await client.query(`
      INSERT INTO users (name, email, password, address, role)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (email) DO NOTHING;
    `, [
      'System Administrator Account',
      adminEmail,
      hashedPassword,
      '123 Admin Headquarters, Main Commercial Avenue',
      'admin'
    ]);

    await client.query('COMMIT');
    console.log('✅ Database setup completed successfully!');
    console.log(`ℹ️ Default admin email: ${adminEmail}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Database setup failed:', err.message);
    throw err;
  } finally {
    client.release();
    if (closePoolOnFinish) {
      await pool.end();
    }
  }
};

if (require.main === module) {
  setupDatabase(true).catch(() => {
    process.exit(1);
  });
}

module.exports = { setupDatabase };
