// ✅ Netflix Bot with PostgreSQL Storage + Full Commands + JSON Migration
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Imap = require("imap");
const { simpleParser } = require("mailparser");
const fs = require("fs");
const crypto = require("crypto");
const quotedPrintable = require("quoted-printable");
const { Pool } = require("pg");

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// In-memory pending maps for flows that require multi-step interaction
const pendingUserAdd = {};   // adminId -> { id, uname }
const pendingAdminActions = {}; // to keep simple contexts if needed

// Initialize DB (tables) and migrate JSON if present
(async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS authorized_users (
        user_id TEXT PRIMARY KEY,
        username TEXT,
        expires TIMESTAMP
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS license_keys (
        key TEXT PRIMARY KEY,
        duration INT,
        expires TIMESTAMP,
        used BOOLEAN DEFAULT false
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS gmail_store (
        user_id TEXT PRIMARY KEY,
        email TEXT,
        password TEXT
      )
    `);

    // Migration from old JSON files if they exist
    try {
      if (fs.existsSync("auth-store.json")) {
        const authData = JSON.parse(fs.readFileSync("auth-store.json", "utf-8"));

        if (authData.authorized) {
          for (const [id, u] of Object.entries(authData.authorized)) {
            await db.query(
              `INSERT INTO authorized_users (user_id, username, expires)
               VALUES ($1, $2, $3)
               ON CONFLICT (user_id) DO NOTHING`,
              [id, u.username, u.expires]
            );
          }
        }

        if (authData.keys) {
          for (const [key, k] of Object.entries(authData.keys)) {
            await db.query(
              `INSERT INTO license_keys (key, duration, expires, used)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (key) DO NOTHING`,
              [key, k.duration, k.expires, k.used]
            );
          }
        }
        console.log("✅ Migrated auth-store.json to PostgreSQL");
      }

      if (fs.existsSync("gmail-store.json")) {
        const gmailData = JSON.parse(fs.readFileSync("gmail-store.json", "utf-8"));
        for (const [id, g] of Object.entries(gmailData)) {
          await db.query(
            `INSERT INTO gmail_store (user_id, email, password)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id) DO NOTHING`,
            [id, g.email, g.password]
          );
        }
        console.log("✅ Migrated gmail-store.json to PostgreSQL");
      }
    } catch (mErr) {
      console.error("❌ Migration error:", mErr.message);
    }

    console.log("✅ DB ready");
  } catch (err) {
    console.error("DB initialization error:", err);
    process.exit(1);
  }
})();

const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",") : [];
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Helpers
const isAuthorized = async (id) => {
  try {
    const res = await db.query(
      `SELECT 1 FROM authorized_users WHERE user_id = $1 AND expires > NOW()`,
      [id]
    );
    return res.rows.length > 0;
  } catch (e) {
    console.error("isAuthorized error:", e.message);
    return false;
  }
};

const getGmail = async (userId) => {
  try {
    let res = await db.query(`SELECT * FROM gmail_store WHERE user_id = $1`, [userId]);
    if (res.rows.length > 0) return res.rows[0];

    // fallback: find first admin gmail
    for (let adminId of ADMIN_IDS) {
      res = await db.query(`SELECT * FROM gmail_store WHERE user_id = $1`, [adminId]);
      if (res.rows.length > 0) return res.rows[0];
    }
    return null;
  } catch (e) {
    console.error("getGmail error:", e.message);
    return null;
  }
};

const saveAuthorizedUser = async (userId, username, expiresISO) => {
  await db.query(
    `INSERT INTO authorized_users (user_id, username, expires)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username, expires = EXCLUDED.expires`,
    [userId, username, expiresISO]
  );
};

const deleteAuthorizedUser = async (userId) => {
  await db.query(`DELETE FROM authorized_users WHERE user_id = $1`, [userId]);
};

// Start command
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const username = msg.from.username || msg.from.first_name;
  const isAdmin = ADMIN_IDS.includes(userId);

  const buttons = [[
    { text: "🔐 Sign-in Code", callback_data: "signin" },
    { text: "🏠 Household Access", callback_data: "household" },
    { text: "🔁 Password Reset Link", callback_data: "resetpass" }
  ]];

  if (isAdmin) {
  buttons.push([
    { text: "📥 Set Gmail", callback_data: "setgmail" },
    { text: "📧 My Gmail", callback_data: "mygmail" },
    { text: "📤 Delete Gmail", callback_data: "deletegmail" }
  ]);
  buttons.push([
    { text: "🗝️ Generate Key", callback_data: "genkey" },
    { text: "👥 Userlist", callback_data: "userlist" }
  ]);
  buttons.push([
    { text: "📂 Accounts", callback_data: "accounts" } // <-- नया बटन यहाँ
  ]);
} else {
  buttons.push([{ text: "🔓 Redeem Key", callback_data: "redeem" }]);
  buttons.push([{ text: "📂 Accounts", callback_data: "accounts" }]); // <-- यूज़र के लिए भी
}

  bot.sendMessage(chatId, `Hello @${username}!\nChoose what you want to do:`, {
    reply_markup: { inline_keyboard: buttons }
  });
});

// Gmail Save via plain message (admin only)
bot.on("message", async (msg) => {
  // ignore messages that are commands (start handled above) or not text
  if (!msg.text) return;
  const userId = msg.from.id.toString();
  const isAdmin = ADMIN_IDS.includes(userId);
  const text = msg.text.trim();

  // If admin sent "email password" to store Gmail
  if (isAdmin && text.includes("@gmail.com") && text.split(" ").length === 2) {
    const [email, password] = text.split(" ");
    try {
      await db.query(
        `INSERT INTO gmail_store (user_id, email, password)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, password = EXCLUDED.password`,
        [userId, email, password]
      );
      return bot.sendMessage(msg.chat.id, `✅ Gmail set successfully: ${email}`);
    } catch (e) {
      console.error("set gmail error:", e.message);
      return bot.sendMessage(msg.chat.id, `❌ Error saving Gmail.`);
    }
  }

  // Other messages are ignored here to avoid interfering with callback-based flows.
});

// Callback handler (mainly all button actions)
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const username = query.from.username || "Unknown";

  try {
    if (data === "signin") {
      return bot.sendMessage(chatId, "🔐 Please send your sign-in code.");

    } else if (data === "household") {
      return bot.sendMessage(chatId, "🏠 Please send household details.");

    } else if (data === "resetpass") {
      return bot.sendMessage(chatId, "🔁 Please send your password reset link.");

    } else if (data === "setgmail") {
      return bot.sendMessage(chatId, "📥 Please send Gmail credentials to save.");

    } else if (data === "mygmail") {
      const res = await db.query(
        "SELECT email FROM gmail_store WHERE user_id = $1",
        [chatId]
      );
      if (res.rows.length === 0) {
        return bot.sendMessage(chatId, "📭 You have no Gmail saved.");
      }
      const list = res.rows.map(r => `📧 ${r.email}`).join("\n");
      return bot.sendMessage(chatId, `📜 Your Gmail(s):\n\n${list}`);

    } else if (data === "deletegmail") {
      await db.query("DELETE FROM gmail_store WHERE user_id = $1", [chatId]);
      return bot.sendMessage(chatId, "✅ Gmail deleted successfully.");

    } else if (data === "genkey") {
      const key = Math.random().toString(36).substring(2, 10).toUpperCase();
      return bot.sendMessage(chatId, `🗝️ Generated Key: <b>${key}</b>`, { parse_mode: "HTML" });

    } else if (data === "userlist") {
      const res = await db.query("SELECT DISTINCT user_id FROM gmail_store");
      if (res.rows.length === 0) {
        return bot.sendMessage(chatId, "📭 No users found.");
      }
      const list = res.rows.map((u, i) => `${i + 1}. ${u.user_id}`).join("\n");
      return bot.sendMessage(chatId, `👥 User List:\n\n${list}`);

    } else if (data === "accounts") {
      const res = await db.query(
        "SELECT email, password, expires, buyer_username, buyer_id FROM gmail_store ORDER BY expires DESC"
      );
      if (res.rows.length === 0) {
        return bot.sendMessage(chatId, "📭 No accounts found.");
      }
      const accounts = res.rows.map(acc => {
        const exp = acc.expires ? new Date(acc.expires).toLocaleDateString() : "N/A";
        return `📧 <b>${acc.email}</b>\n🔑 ${acc.password}\n⏳ Expiry: ${exp}\n👤 Buyer: ${acc.buyer_username || "N/A"} (${acc.buyer_id || "N/A"})`;
      }).join("\n\n");
      return bot.sendMessage(chatId, `📂 <b>Accounts:</b>\n\n${accounts}`, { parse_mode: "HTML" });

    } else if (data === "redeem") {
      return bot.sendMessage(chatId, "🔓 Please send your redeem key.");
    }

  } catch (err) {
    console.error("callback_query handler error:", err.message);
    bot.sendMessage(chatId, "⚠️ Error processing action.");
  }
});
