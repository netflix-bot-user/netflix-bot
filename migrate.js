// migrate.js
const db = require('./db');

async function run() {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS authorized_users (
      user_id TEXT PRIMARY KEY,
      username TEXT,
      expires TIMESTAMP
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS gmail_store (
      user_id TEXT PRIMARY KEY,
      email TEXT,
      password TEXT
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS license_keys (
      key_text TEXT PRIMARY KEY,
      duration_months INT,
      expires TIMESTAMP,
      used BOOLEAN DEFAULT false
    )`);

    console.log('✅ Migrations completed');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration error', err);
    process.exit(1);
  }
}

run();
