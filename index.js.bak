// ✅ Netflix Bot with Licensing System + Gmail + Fixes

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Imap = require("imap");
const { simpleParser } = require("mailparser");
const fs = require("fs");
const crypto = require("crypto");
const db = require("./db");

const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",") : [];
let pendingUserAdd = {};

// Bot init
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Check if user is authorized
const isAuthorized = async (id) => {
  const res = await db.query(
    "SELECT 1 FROM authorized_users WHERE user_id = $1 AND expires > NOW()",
    [id]
  );
  return res.rowCount > 0;
};

// /start command
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const username = msg.from.username || msg.from.first_name;
  const isAdmin = ADMIN_IDS.includes(userId);
  const authorized = await isAuthorized(userId);

  let buttons = [];

  if (isAdmin) {
    buttons = [
      [
        { text: "🔐 Sign-in Code", callback_data: "signin" },
        { text: "🏠 Household Access", callback_data: "household" },
        { text: "🔁 Password Reset Link", callback_data: "resetpass" }
      ],
      [
        { text: "📥 Set Gmail", callback_data: "setgmail" },
        { text: "📧 My Gmail", callback_data: "mygmail" },
        { text: "📤 Delete Gmail", callback_data: "deletegmail" }
      ],
      [
        { text: "🗝️ Generate Key", callback_data: "genkey" },
        { text: "👥 Userlist", callback_data: "userlist" }
      ]
    ];
  } else if (authorized) {
    buttons = [
      [
        { text: "🔐 Sign-in Code", callback_data: "signin" },
        { text: "🏠 Household Access", callback_data: "household" }
      ],
      [{ text: "🔓 Redeem Key", callback_data: "redeem" }]
    ];
  } else {
    buttons = [[{ text: "🔓 Redeem Key", callback_data: "redeem" }]];
  }

  bot.sendMessage(chatId, `Hello @${username}!\nChoose what you want to do:`, {
    reply_markup: { remove_keyboard: true, inline_keyboard: buttons }
  });
});

// Callback query handler
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id.toString();
  const username = query.from.username || query.from.first_name;
  const data = query.data;
  const isAdmin = ADMIN_IDS.includes(userId);

  // License check
  if (!isAdmin && ["signin", "household"].includes(data)) {
    if (!(await isAuthorized(userId))) {
      return bot.sendMessage(
        chatId,
        "🚫 You are not a member of this bot.\nPlease Please Redeem Your Licance Key to get membership."
      );
    }
  }

  // Generate Key
  if (data === "genkey") {
    return bot.sendMessage(chatId, "Select key duration:", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "1 Month", callback_data: "key_1" },
            { text: "3 Months", callback_data: "key_3" },
            { text: "6 Months", callback_data: "key_6" },
            { text: "12 Months", callback_data: "key_12" }
          ]
        ]
      }
    });
  }

  if (data.startsWith("key_")) {
    const months = parseInt(data.split("_")[1]);
    const key = "NETFLIX-" + crypto.randomBytes(3).toString("hex").toUpperCase();
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + months);

    await db.query(
      `INSERT INTO license_keys (key_text, duration_months, expires, used)
       VALUES ($1, $2, $3, false)`,
      [key, months, expiry.toISOString()]
    );

    return bot.sendMessage(
      chatId,
      `✅ Key generated: ${key}\nValid for: ${months} months`
    );
  }

  // Userlist
  if (data === "userlist") {
    const res = await db.query(
      "SELECT user_id, username, expires FROM authorized_users"
    );
    const entries = res.rows;
    const list = entries.length
      ? entries
          .map(
            (u) =>
              `👤 @${u.username || "unknown"} (ID: ${u.user_id})\n⏳ Expires: ${u.expires}`
          )
          .join("\n\n")
      : "👥 No authorized users.";

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

  // Add user
  if (data === "add_user" && isAdmin) {
    bot.sendMessage(
      chatId,
      "📩 Send user ID and username like this:\n`123456789 username`",
      { parse_mode: "Markdown" }
    );

    bot.once("message", (msg) => {
      if (!msg.text) return;
      const parts = msg.text.trim().split(" ");
      if (parts.length < 2)
        return bot.sendMessage(chatId, "⚠️ Invalid format.");

      const [id, uname] = parts;
      pendingUserAdd[userId] = { id, uname };
      bot.sendMessage(chatId, "⏳ Select access duration:", {
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
    });
  }

  // Confirm add user
  if (data.startsWith("confirm_useradd_") && isAdmin) {
    const months = parseInt(data.split("_")[2]);
    const pending = pendingUserAdd[userId];
    if (!pending)
      return bot.sendMessage(chatId, "⚠️ No pending user info. Please start again.");

    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + months);
    await db.query(
      `INSERT INTO authorized_users (user_id, username, expires)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id)
       DO UPDATE SET username = EXCLUDED.username, expires = EXCLUDED.expires`,
      [pending.id, pending.uname, expiry.toISOString()]
    );
    delete pendingUserAdd[userId];
    return bot.sendMessage(
      chatId,
      `✅ User @${pending.uname} added for ${months} month(s).`
    );
  }

  // Remove user
  if (data === "remove_user" && isAdmin) {
    bot.sendMessage(chatId, "❌ Send user ID to remove:");
    bot.once("message", async (msg) => {
      if (!msg.text) return;
      const id = msg.text.trim();
      const check = await db.query(
        "SELECT 1 FROM authorized_users WHERE user_id = $1",
        [id]
      );
      if (check.rowCount === 0)
        return bot.sendMessage(chatId, "⚠️ User not found.");

      await db.query("DELETE FROM authorized_users WHERE user_id = $1", [id]);
      return bot.sendMessage(chatId, `🗑️ User ID ${id} removed.`);
    });
  }

  // बाकी Gmail, resetpass, signin, household का code unchanged रहेगा (सिर्फ null checks जोड़कर)...
});

// Message listener — Gmail set
bot.on("message", async (msg) => {
  const userId = msg.from.id.toString();
  const isAdmin = ADMIN_IDS.includes(userId);

  if (!msg.text) return; // FIX: avoid undefined error

  const text = msg.text;

  if (text.includes("@gmail.com") && text.split(" ").length === 2 && isAdmin) {
    const [email, password] = text.split(" ");

    await db.query(
      `INSERT INTO gmail_store (user_id, email, password)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id)
       DO UPDATE SET email = EXCLUDED.email, password = EXCLUDED.password`,
      [userId, email, password]
    );

    return bot.sendMessage(msg.chat.id, `✅ Gmail set successfully: ${email}`);
  }
});
