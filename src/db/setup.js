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

    // 1. Seed Admin User (Admin@1234)
    const adminEmail = process.env.ADMIN_DEFAULT_EMAIL || 'admin@storerating.com';
    const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'Admin@1234';
    const hashedAdminPassword = await bcrypt.hash(adminPassword, 10);
    await client.query(`
      INSERT INTO users (name, email, password, address, role)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password;
    `, [
      'System Administrator Account',
      adminEmail,
      hashedAdminPassword,
      '123 Admin Headquarters, Main Commercial Avenue',
      'admin'
    ]);

    // 2. Seed Store Owner User (Owner@1234)
    const ownerEmail = 'owner@storerating.com';
    const hashedOwnerPassword = await bcrypt.hash('Owner@1234', 10);
    const ownerRes = await client.query(`
      INSERT INTO users (name, email, password, address, role)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password
      RETURNING id;
    `, [
      'Store Owner Retail Manager',
      ownerEmail,
      hashedOwnerPassword,
      '456 Retail Boulevard, Market Complex Suite 200',
      'store_owner'
    ]);
    const ownerId = ownerRes.rows[0].id;

    // 3. Seed Normal User (User@1234)
    const userEmail = 'user@storerating.com';
    const hashedUserPassword = await bcrypt.hash('User@1234', 10);
    const userRes = await client.query(`
      INSERT INTO users (name, email, password, address, role)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password
      RETURNING id;
    `, [
      'Sample Platform Customer User',
      userEmail,
      hashedUserPassword,
      '789 Customer Residency Lane, Apartment 4B',
      'user'
    ]);
    const customerId = userRes.rows[0].id;

    // 4. Seed sample stores
    const storeRes = await client.query(`
      INSERT INTO stores (name, email, address, owner_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO UPDATE SET owner_id = EXCLUDED.owner_id
      RETURNING id;
    `, [
      'Grand Central Supermarket Store',
      'grandcentral@storemail.com',
      '100 Main Commercial Plaza, Downtown Center',
      ownerId
    ]);
    const storeId = storeRes.rows[0].id;

    await client.query(`
      INSERT INTO stores (name, email, address, owner_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO NOTHING;
    `, [
      'Green Valley Organic Groceries',
      'greenvalley@storemail.com',
      '220 Eco Garden Highway, North District',
      null
    ]);

    // 5. Seed sample rating
    await client.query(`
      INSERT INTO ratings (store_id, user_id, rating)
      VALUES ($1, $2, 5)
      ON CONFLICT (store_id, user_id) DO UPDATE SET rating = 5;
    `, [storeId, customerId]);

    await client.query('COMMIT');
    console.log('✅ Database setup completed successfully!');
    console.log(`ℹ️ Admin Account: ${adminEmail} / ${adminPassword}`);
    console.log(`ℹ️ Store Owner: ${ownerEmail} / Owner@1234`);
    console.log(`ℹ️ Normal User: ${userEmail} / User@1234`);
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
