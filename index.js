// ✅ Netflix Bot with PostgreSQL Storage + Full Commands + JSON Migration
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Imap = require("imap");
const { simpleParser } = require("mailparser");
const fs = require("fs");
const crypto = require("crypto");
const quotedPrintable = require("quoted-printable");
const { Pool } = require("pg");

const CHANNEL_ID = process.env.CHANNEL_ID;

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

await db.query(`
  CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    email TEXT,
    password TEXT,
    buyer_id TEXT,
    expiry TIMESTAMP
  )
`);

// 🔄 Move expired accounts to Unsold Stock
async function moveExpiredAccounts() {
  try {
    const expired = await db.query(
      `SELECT * FROM accounts WHERE expiry < NOW()`
    );

    for (const acc of expired.rows) {
      // Add to unsold_stock
      await db.query(
        `INSERT INTO unsold_stock (email, password) VALUES ($1, $2)`,
        [acc.email, acc.password]
      );

      // Remove from accounts
      await db.query(`DELETE FROM accounts WHERE id = $1`, [acc.id]);
    }

    if (expired.rows.length > 0) {
      console.log(`Moved ${expired.rows.length} expired accounts to Unsold Stock`);
    }
  } catch (err) {
    console.error("Error moving expired accounts:", err);
  }
}

// 📢 Send expiry reminders (3 days, 2 days, 1 day before expiry)
async function sendExpiryReminders() {
  try {
    const res = await db.query(`
      SELECT a.email, a.buyer_id, a.expiry, u.username
      FROM accounts a
      LEFT JOIN authorized_users u ON a.buyer_id = u.user_id
      WHERE a.expiry::date IN (
        (CURRENT_DATE + INTERVAL '1 day')::date,
        (CURRENT_DATE + INTERVAL '2 day')::date,
        (CURRENT_DATE + INTERVAL '3 day')::date
      )
      AND a.buyer_id IS NOT NULL
    `);

    for (const row of res.rows) {
      const { email, buyer_id, expiry } = row;
      const daysLeft = Math.ceil((new Date(expiry) - new Date()) / (1000 * 60 * 60 * 24));

      let message = `⚠️ Reminder: Your plan for *${email}* will expire in ${daysLeft} day(s) (${new Date(expiry).toLocaleDateString()}). Please renew.`;

      try {
        // Send reminder to user
        await bot.sendMessage(buyer_id, message, { parse_mode: "Markdown" });

        // If only 1 day left → also send to channel
        if (daysLeft === 1) {
          await bot.sendMessage(process.env.CHANNEL_ID, `📢 Last Reminder!\n${message}`, { parse_mode: "Markdown" });
        }
      } catch (err) {
        console.error(`❌ Failed to send reminder to ${buyer_id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("❌ Expiry reminder error:", err.message);
  }
}

// ⏰ Run expired account mover daily (every 24h)
setInterval(moveExpiredAccounts, 24 * 60 * 60 * 1000);

// ✅ Run expiry reminders daily (every 24h)
setInterval(sendExpiryReminders, 24 * 60 * 60 * 1000);

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
  buttons.push([{ text: "📦 Unsold Stock", callback_data: "unsold_stock" }]);
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
let awaitingKey = {};

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const fromId = query.from.id.toString();
  const username = query.from.username || query.from.first_name;
  const data = query.data;
  const isAdmin = ADMIN_IDS.includes(fromId);
  
console.log("📥 Callback received:", data);
await bot.sendMessage(chatId, `📥 Callback received: ${data}`);

  try {
    // --- GENERATE KEY (admin) ---
if (data === "genkey") {
    if (!isAdmin) return bot.sendMessage(chatId, "🚫 You are not admin.");
    return bot.sendMessage(chatId, "🗝️ Select key duration:", {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "1 Month", callback_data: "key_1" },
                    { text: "3 Months", callback_data: "key_3" }
                ],
                [
                    { text: "6 Months", callback_data: "key_6" },
                    { text: "12 Months", callback_data: "key_12" }
                ]
            ]
        }
    });
}

if (data.startsWith("key_")) {
    if (!isAdmin) return bot.sendMessage(chatId, "🚫 You are not admin.");
    
    const months = parseInt(data.split("_")[1], 10);
    const key = "NETFLIX-" + crypto.randomBytes(3).toString("hex").toUpperCase();

    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + months);

    try {
        await db.query(
            `INSERT INTO license_keys (license_key, duration_months, expires, used, created_at, key_text)
             VALUES ($1, $2, $3, $4, NOW(), $5)`,
            [key, months, expiry.toISOString(), false, key]
        );

        return bot.sendMessage(
            chatId, 
            `✅ Key generated: \`${key}\`\nValid for: ${months} month(s)\n⚠️ Must be activated before expiry date.`,
            { parse_mode: "Markdown" }
        );

    } catch (e) {
        console.error("DB Insert error in key generation:", e.message);
        return bot.sendMessage(chatId, "❌ DB error while generating key.");
    }
}

    // --- USERLIST (admin) ---
    if (data === "userlist") {
      if (!isAdmin) return bot.sendMessage(chatId, "🚫 You are not admin.");
      const res = await db.query(`SELECT user_id, username, expires FROM authorized_users ORDER BY expires DESC`);
      if (res.rows.length === 0) {
        return bot.sendMessage(chatId, "👥 No authorized users.");
      }
      const list = res.rows.map(r => `👤 @${r.username || "unknown"} (ID: ${r.user_id})\n⏳ Expires: ${new Date(r.expires).toISOString()}`).join("\n\n");
      return bot.sendMessage(chatId, `📋 Authorized Users:\n\n${list}`, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "➕ Add User", callback_data: "add_user" },
              { text: "➖ Remove User", callback_data: "remove_user" }
            ]
          ]
        }
      });
    }

// --- UNSOLD STOCK LIST (Admin) ---
if (data === "unsold_stock") {
    if (!isAdmin) return bot.sendMessage(chatId, "🚫 Admin only.");

    try {
        const res = await db.query(`SELECT * FROM unsold_stock ORDER BY id DESC`);
        if (res.rows.length === 0) {
            return bot.sendMessage(chatId, "📦 No unsold stock available.\n\nClick below to add new stock.", {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "➕ Add to Unsold", callback_data: "add_unsold" }]
                    ]
                }
            });
        }

        let messageText = "📦 *Unsold Stock List:*\n\n";
        let keyboard = [];

        res.rows.forEach((row, index) => {
            messageText += `${index + 1}. 📧 ${row.email} | Exp: ${row.expiry ? new Date(row.expiry).toLocaleDateString() : "N/A"}\n`;

            keyboard.push([
                { text: "✅ Sell", callback_data: `sell_unsold_${row.id}` },
                { text: "🗑 Delete", callback_data: `delete_unsold_${row.id}` }
            ]);
        });

        // Add "Add to Unsold" button at the bottom
        keyboard.push([{ text: "➕ Add to Unsold", callback_data: "add_unsold" }]);

        bot.sendMessage(chatId, messageText, {
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: keyboard }
        });

    } catch (err) {
        console.error("Unsold Stock Error:", err);
        bot.sendMessage(chatId, "⚠️ Error fetching unsold stock.");
    }
    return;
}

// 🛒 SELL UNSOLD STOCK - Step 1: Duration select
if (data.startsWith("sell_unsold_")) {
    if (!isAdmin) return bot.sendMessage(chatId, "🚫 Admin only.");
    const stockId = data.split("_")[2];

    return bot.sendMessage(chatId, "⏳ Select plan duration:", {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "1 Month", callback_data: `sell_dur_${stockId}_1` },
                    { text: "3 Months", callback_data: `sell_dur_${stockId}_3` }
                ],
                [
                    { text: "6 Months", callback_data: `sell_dur_${stockId}_6` },
                    { text: "12 Months", callback_data: `sell_dur_${stockId}_12` }
                ]
            ]
        }
    });
}

// Step 2: Ask buyer ID
if (data.startsWith("sell_dur_")) {
    if (!isAdmin) return bot.sendMessage(chatId, "🚫 Admin only.");
    const parts = data.split("_");
    const stockId = parts[2];
    const months = parseInt(parts[3]);

    bot.sendMessage(chatId, "📩 Send buyer's Telegram User ID:");

    bot.once("message", async (msg) => {
        const buyerId = msg.text.trim();
        try {
            // Get account from unsold_stock
            const res = await db.query(`SELECT * FROM unsold_stock WHERE id = $1`, [stockId]);
            if (res.rows.length === 0) return bot.sendMessage(chatId, "⚠️ Stock not found.");

            const { email, password } = res.rows[0];

            // Buyer का username fetch करना
            let buyerUsername = "";
            try {
                const buyerInfo = await bot.getChat(buyerId);
                buyerUsername = buyerInfo.username || buyerInfo.first_name || "";
            } catch (e) {
                buyerUsername = "unknown";
            }

            // Expiry set करना
            let expiry = new Date();
            expiry.setMonth(expiry.getMonth() + months);

            // Accounts में insert
            await db.query(
                `INSERT INTO accounts (email, password, buyer_id, expiry) VALUES ($1, $2, $3, $4)`,
                [email, password, buyerId, expiry]
            );

            // Unsold से delete
            await db.query(`DELETE FROM unsold_stock WHERE id = $1`, [stockId]);

            // Seller को भेजना monospace format में
            await bot.sendMessage(chatId,
                "```\n📧 " + email + "\n🔑 " + password + "\n```",
                { parse_mode: "Markdown" }
            );

            // Buyer को भी भेजना
            await bot.sendMessage(buyerId,
                "```\n📧 " + email + "\n🔑 " + password + "\n```",
                { parse_mode: "Markdown" }
            );

            bot.sendMessage(chatId, `✅ Sold to @${buyerUsername} (ID: ${buyerId}) for ${months} month(s).`);

        } catch (err) {
            console.error("Sell flow error:", err.message);
            bot.sendMessage(chatId, "❌ Error selling stock.");
        }
    });
}

// 🗑 DELETE UNSOLD STOCK
if (data.startsWith("delete_unsold_")) {
    if (!isAdmin) return bot.sendMessage(chatId, "🚫 Admin only.");
    const stockId = data.split("_")[2];

    try {
        const res = await db.query(`DELETE FROM unsold_stock WHERE id = $1 RETURNING *`, [stockId]);
        if (res.rows.length === 0) {
            return bot.sendMessage(chatId, "⚠️ Stock not found or already deleted.");
        }
        bot.sendMessage(chatId, `🗑 Deleted unsold stock: ${res.rows[0].email}`);
    } catch (err) {
        console.error("Delete unsold stock error:", err.message);
        bot.sendMessage(chatId, "❌ Error deleting stock.");
    }
    return;
}

// ➕ ADD TO UNSOLD STOCK
if (data === "add_unsold") {
    if (!isAdmin) return bot.sendMessage(chatId, "🚫 Admin only.");

    bot.sendMessage(chatId, "📧 Send email for the new account:");

    let step = 1;
    let email = "";
    let password = "";

    const listener = async (msg) => {
        if (msg.chat.id !== chatId) return;

        if (step === 1) {
            email = msg.text.trim();
            step++;
            return bot.sendMessage(chatId, "🔑 Send password for the new account:");
        } 
        else if (step === 2) {
            password = msg.text.trim();
            try {
                await db.query(
                    `INSERT INTO unsold_stock (email, password) VALUES ($1, $2)`,
                    [email, password]
                );
                bot.sendMessage(chatId, `✅ Added to Unsold Stock:\n📧 ${email}\n🔑 ${password}`);
            } catch (err) {
                console.error("Add unsold stock error:", err.message);
                bot.sendMessage(chatId, "❌ Error adding unsold stock.");
            }
            bot.removeListener("message", listener);
        }
    };

    bot.on("message", listener);
}

// --- REDEEM KEY ---
if (data === "redeem") {
  if (isAdmin) return bot.sendMessage(chatId, "🚫 Admins cannot redeem keys.");
  const ok = await isAuthorized(fromId);
  if (ok) return bot.sendMessage(chatId, "✅ You already have membership.");

  awaitingKey[chatId] = true;
  return bot.sendMessage(chatId, "🔑 Please enter your license key:");
}

    // --- ADD USER (admin flow) ---
    if (data === "add_user") {
      if (!isAdmin) return bot.sendMessage(chatId, "🚫 You are not admin.");
      await bot.sendMessage(chatId, "📩 Send user ID and username like this:\n`123456789 username`", { parse_mode: "Markdown" });

      // wait for next message
      bot.once("message", async (msg) => {
        try {
          if (!msg.text) return bot.sendMessage(chatId, "⚠️ Invalid input.");
          const parts = msg.text.trim().split(" ");
          if (parts.length < 2) return bot.sendMessage(chatId, "⚠️ Invalid format. Use: `123456789 username`", { parse_mode: "Markdown" });

          const [id, uname] = parts;
          pendingUserAdd[fromId] = { id, uname };
          return bot.sendMessage(chatId, "⏳ Select access duration:", {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "1 Month", callback_data: "confirm_useradd_1" },
                  { text: "3 Months", callback_data: "confirm_useradd_3" }
                ],
                [
                  { text: "6 Months", callback_data: "confirm_useradd_6" },
                  { text: "12 Months", callback_data: "confirm_useradd_12" }
                ]
              ]
            }
          });
        } catch (e) {
          console.error("add_user message handler error:", e.message);
          return bot.sendMessage(chatId, "⚠️ Error during add user flow.");
        }
      });
      return;
    }

    if (data.startsWith("confirm_useradd_")) {
      if (!isAdmin) return bot.sendMessage(chatId, "🚫 You are not admin.");
      const months = parseInt(data.split("_")[2], 10);
      const pending = pendingUserAdd[fromId];
      if (!pending) return bot.sendMessage(chatId, "⚠️ No pending user info. Please start again with Add User.");

      const expiry = new Date();
      expiry.setMonth(expiry.getMonth() + months);

      await saveAuthorizedUser(pending.id, pending.uname, expiry.toISOString());
      delete pendingUserAdd[fromId];
      return bot.sendMessage(chatId, `✅ User @${pending.uname} added for ${months} month(s).`);
    }

    // --- REMOVE USER (admin flow) ---
    if (data === "remove_user") {
      if (!isAdmin) return bot.sendMessage(chatId, "🚫 You are not admin.");
      await bot.sendMessage(chatId, "❌ Send user ID to remove:");

      bot.once("message", async (msg) => {
        try {
          if (!msg.text) return bot.sendMessage(chatId, "⚠️ Invalid input.");
          const id = msg.text.trim();
          const res = await db.query(`SELECT 1 FROM authorized_users WHERE user_id = $1`, [id]);
          if (res.rows.length === 0) return bot.sendMessage(chatId, "⚠️ User not found.");
          await deleteAuthorizedUser(id);
          return bot.sendMessage(chatId, `🗑️ User ID ${id} removed.`);
        } catch (e) {
          console.error("remove_user handler error:", e.message);
          return bot.sendMessage(chatId, "⚠️ Error removing user.");
        }
      });
      return;
    }

    // 🎯 Redeem Key Handler (message listener)
bot.on("message", async (msg) => {
    const chatId = msg.chat.id;

    // अगर यूज़र redeem mode में है
    if (awaitingKey[chatId]) {
        const keyInput = msg.text.trim();
        console.log("DEBUG: Redeem request for key =", keyInput);

        try {
            // Key ढूंढो
            const res = await db.query(
                `SELECT * FROM license_keys 
                 WHERE license_key = $1
                 AND used = false
                 AND (expires IS NULL OR expires > NOW())`,
                [keyInput]
            );

            if (res.rows.length === 0) {
                delete awaitingKey[chatId];
                return bot.sendMessage(chatId, "❌ Invalid or expired key.");
            }

            const keyData = res.rows[0];

            // ✅ Mark key as used
            await db.query(
                `UPDATE license_keys 
                 SET used = true, used_by = $1, used_at = NOW()
                 WHERE license_key = $2`,
                [chatId, keyInput]
            );

            // Membership expiry date निकालो
            const expiry = new Date();
            expiry.setMonth(expiry.getMonth() + keyData.duration_months);

            // Authorized user save करो
            await saveAuthorizedUser(chatId.toString(), msg.from.username || msg.from.first_name, expiry.toISOString());

            bot.sendMessage(
                chatId, 
                `✅ Key redeemed successfully!\nMembership activated for ${keyData.duration_months} month(s).\nYour Key: \`${keyInput}\``,
                { parse_mode: "Markdown" }
            );

        } catch (e) {
            console.error("Redeem key error:", e);
            bot.sendMessage(chatId, "⚠️ Error processing key.");
        }

        // आखिर में mode reset कर दो
        delete awaitingKey[chatId];
    }
});

	// helper: escape text for HTML parse_mode
function escapeHtml(text) {
  if (!text && text !== 0) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 📂 Accounts main view
if (data === "accounts") {
  const ok = await isAuthorized(fromId);
  if (!ok && !isAdmin) {
    return bot.sendMessage(chatId, "🚫 You are not a member of this bot.\nPlease Redeem Your license Key to get membership.");
  }

  try {
    if (isAdmin) {
      const res = await db.query(`
        SELECT a.id, a.email, a.expiry, u.username, u.user_id
        FROM accounts a
        LEFT JOIN authorized_users u ON a.buyer_id = u.user_id
        ORDER BY a.expiry ASC
      `);

      if (res.rows.length === 0) {
        return bot.sendMessage(chatId, "📂 No accounts found.", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "➕ Add Account", callback_data: "add_account" }]
            ]
          }
        });
      }

      let textMsg = "📂 <b>All Accounts</b>\n\n";
      res.rows.forEach(row => {
        const email = escapeHtml(row.email || "");
        const expiry = row.expiry ? new Date(row.expiry).toLocaleDateString() : "N/A";
        const buyerUsername = escapeHtml(row.username || "unknown");
        const buyerId = escapeHtml(row.user_id || row.buyer_id || "");
        textMsg += `🆔 <b>${row.id}</b>\n📧 ${email}\n⏳ Expiry: ${expiry}\n👤 Buyer: @${buyerUsername} (ID: ${buyerId})\n\n`;
      });

      return bot.sendMessage(chatId, textMsg, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "✏️ Edit Accounts", callback_data: "edit_accounts" }],
            [
              { text: "➕ Add Account", callback_data: "add_account" },
              { text: "➖ Remove Account", callback_data: "remove_account" }
            ]
          ]
        }
      });

    } else {
      const res = await db.query(`SELECT id, email, expiry FROM accounts WHERE buyer_id = $1 ORDER BY expiry ASC`, [fromId]);
      if (res.rows.length === 0) return bot.sendMessage(chatId, "📂 You have no accounts.");

      let textMsg = "📂 <b>Your Accounts</b>\n\n";
      res.rows.forEach(row => {
        const email = escapeHtml(row.email || "");
        const expiry = row.expiry ? new Date(row.expiry).toLocaleDateString() : "N/A";
        textMsg += `🆔 <b>${row.id}</b>\n📧 ${email}\n⏳ Expiry: ${expiry}\n\n`;
      });

      return bot.sendMessage(chatId, textMsg, { parse_mode: "HTML" });
    }
  } catch (err) {
    console.error("accounts handler error:", err.message);
    return bot.sendMessage(chatId, "⚠️ Error fetching accounts.");
  }
}

// ✏️ Edit Accounts list
if (data === "edit_accounts") {
  if (!isAdmin) return bot.sendMessage(chatId, "🚫 Admin only.");

  const res = await db.query(`
    SELECT a.id, a.email
    FROM accounts a
    ORDER BY a.expiry ASC
  `);

  if (res.rows.length === 0) {
    return bot.sendMessage(chatId, "📂 No accounts to edit.");
  }

  let buttons = res.rows.map(row => {
    return [{ text: `✏️ Edit ${row.id}`, callback_data: `edit_acc_${row.id}` }];
  });

  return bot.sendMessage(chatId, "✏️ Select an account to edit:", {
    reply_markup: { inline_keyboard: buttons }
  });
}

// ✏️ Edit Account
if (data.startsWith("edit_acc_")) {
  if (!isAdmin) return bot.sendMessage(chatId, "🚫 Admin only.");
  const accId = data.split("_")[2];
  return bot.sendMessage(chatId, "✏️ Edit Options:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔄 Renew", callback_data: `renew_acc_${accId}` }],
        [{ text: "♻️ Replace Account", callback_data: `replace_acc_${accId}` }]
      ]
    }
  });
}

// 🔄 Renew Step 1
if (data.startsWith("renew_acc_") && data.split("_").length === 3) {
  const accId = data.split("_")[2];
  return bot.sendMessage(chatId, "🔄 Select renewal period:", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "1 Month", callback_data: `renew_acc_${accId}_1` },
          { text: "3 Months", callback_data: `renew_acc_${accId}_3` }
        ],
        [
          { text: "6 Months", callback_data: `renew_acc_${accId}_6` },
          { text: "12 Months", callback_data: `renew_acc_${accId}_12` }
        ]
      ]
    }
  });
}

// 🔄 Renew Step 2
if (data.startsWith("renew_acc_") && data.split("_").length === 4) {
  const accId = data.split("_")[2];
  const months = parseInt(data.split("_")[3]);
  const res = await db.query(`SELECT expiry FROM accounts WHERE id = $1`, [accId]);
  if (res.rows.length === 0) return bot.sendMessage(chatId, "⚠️ Account not found.");

  let expiry = new Date(res.rows[0].expiry);
  expiry.setMonth(expiry.getMonth() + months);

  await db.query(`UPDATE accounts SET expiry = $1 WHERE id = $2`, [expiry, accId]);
  return bot.sendMessage(chatId, `✅ Expiry extended by ${months} month(s).`);
}

// ♻️ Replace Account
if (data.startsWith("replace_acc_")) {
  if (!isAdmin) return bot.sendMessage(chatId, "🚫 Admin only.");
  const accId = data.split("_")[2];
  bot.sendMessage(chatId, "📩 Send new email and password in this format:\n`email@example.com password`", { parse_mode: "Markdown" });

  bot.once("message", async (msg) => {
    if (!msg.text) return bot.sendMessage(chatId, "⚠️ Invalid input.");
    const [email, password] = msg.text.trim().split(" ");
    if (!email || !password) return bot.sendMessage(chatId, "⚠️ Please use correct format.");

    await db.query(`UPDATE accounts SET email = $1, password = $2 WHERE id = $3`, [email, password, accId]);
    return bot.sendMessage(chatId, "✅ Account updated successfully.");
  });
}

// ➕ Add Account
if (data === "add_account") {
  if (!isAdmin) return bot.sendMessage(chatId, "🚫 Admin only.");
  bot.sendMessage(chatId, "📩 Send account details in this format:\n`email@example.com password buyer_id months`", { parse_mode: "Markdown" });

  bot.once("message", async (msg) => {
    if (!msg.text) return bot.sendMessage(chatId, "⚠️ Invalid input.");
    const [email, password, buyer_id, months] = msg.text.trim().split(" ");
    if (!email || !password || !buyer_id || !months) return bot.sendMessage(chatId, "⚠️ Please use correct format.");

    let expiry = new Date();
    expiry.setMonth(expiry.getMonth() + parseInt(months));

    await db.query(
      `INSERT INTO accounts (email, password, buyer_id, expiry) VALUES ($1, $2, $3, $4)`,
      [email, password, buyer_id, expiry]
    );
    return bot.sendMessage(chatId, "✅ Account added successfully.");
  });
}

// ➖ Remove Account (by ID)
if (data === "remove_account") {
  if (!isAdmin) return bot.sendMessage(chatId, "🚫 Admin only.");
  bot.sendMessage(chatId, "🗑️ Send the account ID you want to remove:");

  bot.once("message", async (msg) => {
    const accId = msg.text.trim();
    if (!/^\d+$/.test(accId)) return bot.sendMessage(chatId, "⚠️ Please send a valid numeric ID.");

    const res = await db.query(`SELECT 1 FROM accounts WHERE id = $1`, [accId]);
    if (res.rows.length === 0) return bot.sendMessage(chatId, "⚠️ Account not found.");

    await db.query(`DELETE FROM accounts WHERE id = $1`, [accId]);
    return bot.sendMessage(chatId, `✅ Account ID ${accId} deleted successfully.`);
  });
}

    // --- SET GMAIL (admin) ---
    if (data === "setgmail") {
      if (!isAdmin) return bot.sendMessage(chatId, "🚫 You are not admin.");
      return bot.sendMessage(chatId, "📧 Send Gmail and App Password in this format:\nyouremail@gmail.com yourpassword", { parse_mode: "Markdown" });
    }

    // --- MY GMAIL ---
    if (data === "mygmail") {
      if (!isAdmin) return bot.sendMessage(chatId, "🚫 You are not admin.");
      const res = await db.query(`SELECT email FROM gmail_store WHERE user_id = $1`, [fromId]);
      if (res.rows.length === 0) return bot.sendMessage(chatId, "⚠️ No Gmail is set.");
      return bot.sendMessage(chatId, `📧 Your saved Gmail: ${res.rows[0].email}`);
    }

    // --- DELETE GMAIL ---
    if (data === "deletegmail") {
      if (!isAdmin) return bot.sendMessage(chatId, "🚫 You are not admin.");
      const res = await db.query(`SELECT 1 FROM gmail_store WHERE user_id = $1`, [fromId]);
      if (res.rows.length === 0) return bot.sendMessage(chatId, "⚠️ No Gmail to delete.");
      await db.query(`DELETE FROM gmail_store WHERE user_id = $1`, [fromId]);
      return bot.sendMessage(chatId, "🗑️ Gmail deleted.");
    }

    // --- RESET PASS (only for authorized users + admins) ---
if (data === "resetpass") {
  const ok = await isAuthorized(fromId);
  if (!ok && !isAdmin) {
    return bot.sendMessage(chatId, "🚫 You are not a member of this bot.\nPlease Redeem Your license Key to get membership.");
  }

  const info = await getGmail(fromId);
  if (!info) return bot.sendMessage(chatId, "⚠️ Please ask admin to set Gmail.");
  const { email, password } = info;
  bot.sendMessage(chatId, "⏳ Reading Gmail inbox...");

      const imap = new Imap({
        user: email,
        password,
        host: "imap.gmail.com",
        port: 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
      });

      imap.once("ready", function () {
        imap.openBox("INBOX", false, function (err, box) {
          if (err) {
            bot.sendMessage(chatId, `❌ INBOX error: ${err.message}`);
            imap.end();
            return;
          }

          const searchCriteria = [
            ["FROM", "Netflix"],
            ["SINCE", new Date(Date.now() - 24 * 60 * 60 * 1000)],
            ["SUBJECT", "Reset"]
          ];
          const fetchOptions = { bodies: "", markSeen: true };

          imap.search(searchCriteria, function (err, results) {
            if (err || results.length === 0) {
              bot.sendMessage(chatId, "❌ No recent reset email found.");
              imap.end();
              return;
            }

            const latest = results[results.length - 1];
            const f = imap.fetch(latest, fetchOptions);

            f.on("message", function (msgFetch) {
              let rawEmail = "";
              msgFetch.on("body", function (stream) {
                stream.on("data", chunk => rawEmail += chunk.toString("utf8"));
                stream.on("end", function () {
                  try {
                    const decoded = quotedPrintable.decode(rawEmail).toString("utf8");
                    const allLinks = decoded.match(/https:\/\/www\.netflix\.com\/[^\s<>"'()\[\]]+/gi) || [];
                    const resetLink = allLinks.find(link => link.toLowerCase().includes("password"));

                    if (resetLink) {
                      bot.sendMessage(chatId, `Hi @${username},\n🔁 Netflix Password Reset Link:\n${resetLink}`);
                    } else {
                      bot.sendMessage(chatId, "❌ No password reset link found.");
                    }
                  } catch (e) {
                    console.error("resetpass parse error:", e.message);
                    bot.sendMessage(chatId, "❌ Error reading the email.");
                  }
                  imap.end();
                });
              });
            });

            f.once("error", err => {
              bot.sendMessage(chatId, `❌ Fetch Error: ${err.message}`);
            });
          });
        });
      });

      imap.once("error", function (err) {
        bot.sendMessage(chatId, `❌ IMAP Error: ${err.message}`);
      });

      imap.connect();
      return;
    }

    // --- SIGNIN (OTP) ---
if (data === "signin") {
  if (!isAdmin) {
    const ok = await isAuthorized(fromId);
    if (!ok) {
      return bot.sendMessage(chatId, "🚫 You are not a member of this bot.\nPlease Redeem Your license Key to get membership.");
    }
  }

  const info = await getGmail(fromId);
  if (!info) return bot.sendMessage(chatId, "⚠️ Please ask admin to set Gmail.");
  const { email, password } = info;

  bot.sendMessage(chatId, "⏳ Reading Gmail inbox for Signin OTP...");

  const imap = new Imap({
    user: email,
    password,
    host: "imap.gmail.com",
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
  });

  imap.once("ready", function () {
    imap.openBox("INBOX", false, function (err, box) {
      if (err) {
        bot.sendMessage(chatId, `❌ INBOX error: ${err.message}`);
        imap.end();
        return;
      }

      const searchCriteria = [
        ["FROM", "Netflix"],
        ["SINCE", new Date(Date.now() - 24 * 60 * 60 * 1000)],
      ];
      const fetchOptions = { bodies: ["HEADER", "TEXT"], struct: true };

      imap.search(searchCriteria, function (err, results) {
        if (err || results.length === 0) {
          bot.sendMessage(chatId, "❌ No recent emails found from Netflix.");
          imap.end();
          return;
        }

        const latest = results[results.length - 1];
        const f = imap.fetch(latest, fetchOptions);
        let responded = false;

        f.on("message", function (msgFetch) {
          msgFetch.on("body", function (stream) {
            simpleParser(stream, async (err, parsed) => {
              if (err) {
                bot.sendMessage(chatId, "❌ Error reading email.");
                responded = true;
                imap.end();
                return;
              }

              const body = parsed.text || "";

              if (!responded && body.toLowerCase().includes("sign in to netflix")) {
                const codeMatch = body.match(/\b\d{4}\b/);
                if (codeMatch) {
                  responded = true;
                  bot.sendMessage(chatId, `Hi @${username},\n🔐 Your Netflix OTP is: ${codeMatch[0]}`);
                }
              }

              if (!responded) {
                responded = true;
                bot.sendMessage(chatId, "❌ No valid Netflix OTP found.");
              }

              imap.end();
            });
          });
        });

        f.once("error", function (err) {
          bot.sendMessage(chatId, `❌ Fetch Error: ${err.message}`);
          imap.end();
        });
      });
    });
  });

  imap.once("error", function (err) {
    bot.sendMessage(chatId, `❌ IMAP Error: ${err.message}`);
  });

  imap.connect();
  return;
}

// --- HOUSEHOLD (new logic like reset) ---
if (data === "household") {
  console.log("➡ Household logic entered successfully");
  bot.sendMessage(chatId, "📩 Household button pressed, checking Gmail...");

  if (!isAdmin) {
    const ok = await isAuthorized(fromId);
    if (!ok) {
      return bot.sendMessage(chatId, "🚫 You are not a member of this bot.\nPlease Redeem Your license Key to get membership.");
    }
  }

  const info = await getGmail(fromId);
  if (!info) return bot.sendMessage(chatId, "⚠️ Please ask admin to set Gmail.");
  const { email, password } = info;

  bot.sendMessage(chatId, "⏳ Reading Gmail inbox for Household mail...");

  const imap = new Imap({
    user: email,
    password,
    host: "imap.gmail.com",
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
  });

  imap.once("ready", function () {
    imap.openBox("INBOX", false, function (err, box) {
      if (err) {
        bot.sendMessage(chatId, `❌ INBOX error: ${err.message}`);
        imap.end();
        return;
      }

      // Search last 24 hours (Household or temporary subject)
      const searchCriteria = [
        ["FROM", "Netflix"],
        ["SINCE", new Date(Date.now() - 24 * 60 * 60 * 1000)],
        ["OR", ["SUBJECT", "Household"], ["SUBJECT", "temporary"]],
      ];
      const fetchOptions = { bodies: "", markSeen: true };

      imap.search(searchCriteria, function (err, results) {
        if (err || results.length === 0) {
          bot.sendMessage(chatId, "❌ No recent Household mail found from Netflix.");
          imap.end();
          return;
        }

        const latest = results[results.length - 1];
        const f = imap.fetch(latest, fetchOptions);

        f.on("message", function (msgFetch) {
          let rawEmail = "";
          msgFetch.on("body", function (stream) {
            stream.on("data", (chunk) => (rawEmail += chunk.toString("utf8")));
            stream.on("end", function () {
              try {
                const decoded = quotedPrintable.decode(rawEmail).toString("utf8");

                // Extract all Netflix links
                const allLinks = decoded.match(/https:\/\/www\.netflix\.com\/[^\s<>"'()\[\]]+/gi) || [];
                console.log("🔗 Extracted Netflix links:", allLinks);

                // Filter only "Yes. This Was Me" or "Get Code"
                const householdLinks = allLinks.filter(
                  (link) =>
                    decoded.toLowerCase().includes("yes. this was me") && link.toLowerCase().includes("yes") ||
                    decoded.toLowerCase().includes("get code") && link.toLowerCase().includes("code")
                );

                console.log("✅ Filtered household links:", householdLinks);

                if (householdLinks.length > 0) {
                  for (let link of householdLinks) {
                    bot.sendMessage(chatId, `🏠 Netflix Household Link:\n${link}`);
                  }
                } else {
                  bot.sendMessage(chatId, "❌ No valid household link found in this mail.");
                }
              } catch (e) {
                console.error("❌ Household parse error:", e.message);
                bot.sendMessage(chatId, "❌ Error reading household email.");
              }
              imap.end();
            });
          });
        });

        f.once("error", (err) => {
          console.error("❌ Fetch Error:", err.message);
          bot.sendMessage(chatId, `❌ Fetch Error: ${err.message}`);
        });
      });
    });
  });

  imap.once("error", function (err) {
    console.error("❌ IMAP Error:", err.message);
    bot.sendMessage(chatId, `❌ IMAP Error: ${err.message}`);
  });

  imap.connect();
  return;
}


    // Unknown callback: ignore or ack
    return;
  } catch (err) {
    console.error("callback_query handler error:", err.message);
    try { await bot.sendMessage(chatId, "⚠️ Error processing action."); } catch (_) {}
  }
});

// 🔔 Expiry Reminder System
setInterval(async () => {
  try {
    const res = await db.query(`
      SELECT a.email, a.buyer_id, a.expiry, u.username
      FROM accounts a
      LEFT JOIN authorized_users u ON a.buyer_id = u.user_id
      WHERE a.expiry::date IN (
        (CURRENT_DATE + INTERVAL '3 day')::date,
        (CURRENT_DATE + INTERVAL '2 day')::date,
        (CURRENT_DATE + INTERVAL '1 day')::date
      )
      AND a.buyer_id IS NOT NULL
    `);

    for (const row of res.rows) {
      const { email, buyer_id, expiry } = row;
      const daysLeft = Math.ceil((expiry - new Date()) / (1000 * 60 * 60 * 24));

      let message = `⚠️ Reminder: Your plan for ${email} will expire in ${daysLeft} day(s) (${new Date(expiry).toLocaleDateString()}). Please renew.`;

      try {
        await bot.sendMessage(buyer_id, message);

        // अगर 1 दिन बचा है तो channel पर भी भेजो
        if (daysLeft === 1) {
          await bot.sendMessage(process.env.CHANNEL_ID, `🔔 Reminder for @${row.username || buyer_id}\n${message}`);
        }
      } catch (err) {
        console.error(`❌ Failed to send reminder to ${buyer_id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("❌ Expiry reminder error:", err.message);
  }
}, 24 * 60 * 60 * 1000); // रोज़ाना 1 बार चलेगा

// 🔄 Auto-move expired accounts to Unsold Stock (runs every day)
setInterval(async () => {
    try {
        const res = await db.query(`SELECT * FROM accounts WHERE expiry < NOW()`);
        if (res.rows.length === 0) return;

        for (const acc of res.rows) {
            await db.query(
                `INSERT INTO unsold_stock (email, password) VALUES ($1, $2)`,
                [acc.email, acc.password]
            );
            await db.query(`DELETE FROM accounts WHERE id = $1`, [acc.id]);
            console.log(`♻️ Moved expired account ${acc.email} to Unsold Stock`);
        }
    } catch (err) {
        console.error("Auto-move expired accounts error:", err.message);
    }
}, 24 * 60 * 60 * 1000); // हर 24 घंटे में चलेगा