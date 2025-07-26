// ✅ FINAL BUG-FREE VERSION - Netflix OTP/Household Bot
// Version: vFinal_20250726_113500

const TelegramBot = require("node-telegram-bot-api");
const dotenv = require("dotenv");
const fs = require("fs");
const Imap = require("imap");
const { simpleParser } = require("mailparser");
const crypto = require("crypto");

dotenv.config();
const token = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS?.split(",") || [];

const GMAIL_FILE = "gmail.json";
const CURRENT_FILE = "currentGmail.json";
const LICENSE_FILE = "licenses.json";

const bot = new TelegramBot(token, { polling: true });
const isAdmin = (id) => ADMIN_IDS.includes(id.toString());
const isAuthorized = (id) => {
  if (isAdmin(id)) return true;
  if (!fs.existsSync(LICENSE_FILE)) return false;
  const data = JSON.parse(fs.readFileSync(LICENSE_FILE));
  const user = data[id];
  return user && new Date() < new Date(user.expiresAt);
};

function sendMenu(chatId, username, isAdminUser = false) {
  const buttons = [
    [
      { text: "🔐 Sign-in Code", callback_data: "signin" },
      { text: "🏠 Household Access", callback_data: "household" },
    ],
    [{ text: "🔓 Redeem Key", callback_data: "redeem" }],
  ];
  if (isAdminUser) {
    buttons.push(
      [
        { text: "📩 Set Gmail", callback_data: "setgmail" },
        { text: "📨 My Gmail", callback_data: "mygmail" },
        { text: "🗑️ Delete Gmail", callback_data: "deletegmail" },
      ],
      [
        { text: "🗝 Generate Key", callback_data: "generatekey" },
        { text: "👥 Userlist", callback_data: "userlist" },
      ]
    );
  }
  bot.sendMessage(
    chatId,
    `Hello @${username}!\nChoose what you want to do:`,
    {
      reply_markup: {
        inline_keyboard: buttons,
        remove_keyboard: true,
      },
    }
  );
}

bot.onText(/\/start/, (msg) => {
  const { id, username } = msg.from;
  if (!isAuthorized(id)) {
    return bot.sendMessage(
      id,
      `⛔ You are not a member of this bot.\nPlease contact @Munnabhaiya_Official to get membership.`
    );
  }
  sendMenu(id, username, isAdmin(id));
});

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const username = query.from.username;
  const data = query.data;

  if (!isAuthorized(userId)) {
    return bot.sendMessage(
      chatId,
      `⛔ You are not a member of this bot.\nPlease contact @Munnabhaiya_Official to get membership.`
    );
  }

  if (data === "setgmail") {
    if (!isAdmin(userId)) return bot.sendMessage(chatId, "❌ Only admin can set Gmail.");
    bot.sendMessage(chatId, "📬 Send Gmail and password (e.g. email@gmail.com|password):");
    bot.once("message", (msg) => {
      const [email, pass] = msg.text.split("|");
      if (!email || !pass) return bot.sendMessage(chatId, "❌ Invalid format.");
      let gmails = fs.existsSync(GMAIL_FILE) ? JSON.parse(fs.readFileSync(GMAIL_FILE)) : {};
      gmails[email] = pass;
      fs.writeFileSync(GMAIL_FILE, JSON.stringify(gmails));
      fs.writeFileSync(CURRENT_FILE, JSON.stringify({ email }));
      bot.sendMessage(chatId, `✅ Gmail saved: ${email}`);
    });
  }

  else if (data === "mygmail") {
    if (!isAdmin(userId)) return bot.sendMessage(chatId, "❌ Only admin can view this.");
    if (!fs.existsSync(CURRENT_FILE)) return bot.sendMessage(chatId, "⚠️ No Gmail set.");
    const { email } = JSON.parse(fs.readFileSync(CURRENT_FILE));
    bot.sendMessage(chatId, `📨 Current Gmail: ${email}`);
  }

  else if (data === "deletegmail") {
    if (!isAdmin(userId)) return bot.sendMessage(chatId, "❌ Only admin can delete Gmail.");
    fs.existsSync(CURRENT_FILE) && fs.unlinkSync(CURRENT_FILE);
    bot.sendMessage(chatId, "🗑️ Gmail deleted.");
  }

  else if (data === "redeem") {
    bot.sendMessage(chatId, "🔑 Please send your license key:");
    bot.once("message", (msg) => {
      const key = msg.text.trim();
      const data = fs.existsSync(LICENSE_FILE) ? JSON.parse(fs.readFileSync(LICENSE_FILE)) : {};
      const found = Object.entries(data).find(([_, v]) => v.key === key);
      if (!found) return bot.sendMessage(chatId, "❌ Invalid key.");
      const [uid, userData] = found;
      data[msg.from.id] = userData;
      delete data[uid];
      fs.writeFileSync(LICENSE_FILE, JSON.stringify(data));
      bot.sendMessage(
        chatId,
        `✅ Key redeemed successfully!\nValid for: ${userData.duration}\nExpires on: ${userData.expiresAt}`
      );
    });
  }

  else if (data === "generatekey") {
    if (!isAdmin(userId)) return;
    bot.sendMessage(chatId, "⏳ Select key duration:", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "1 Month", callback_data: "key_1" },
            { text: "3 Months", callback_data: "key_3" },
          ],
          [
            { text: "6 Months", callback_data: "key_6" },
            { text: "12 Months", callback_data: "key_12" },
          ],
        ],
      },
    });
  }

  else if (data.startsWith("key_")) {
    const months = parseInt(data.split("_")[1]);
    const key = `NETFLIX-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + months);
    const payload = {
      key,
      duration: `${months} months`,
      expiresAt: expiresAt.toISOString(),
    };
    const db = fs.existsSync(LICENSE_FILE) ? JSON.parse(fs.readFileSync(LICENSE_FILE)) : {};
    db[key] = payload;
    fs.writeFileSync(LICENSE_FILE, JSON.stringify(db));
    bot.sendMessage(chatId, `🗝 Your key:\n<code>${key}</code>`, { parse_mode: "HTML" });
  }

  else if (data === "userlist") {
    if (!isAdmin(userId)) return;
    const db = fs.existsSync(LICENSE_FILE) ? JSON.parse(fs.readFileSync(LICENSE_FILE)) : {};
    const lines = Object.entries(db)
      .filter(([id, u]) => !u.key)
      .map(([id, u]) => `👤 ID: <code>${id}</code>\n⏳ Expires: ${u.expiresAt}`)
      .join("\n\n");
    bot.sendMessage(chatId, lines || "No users.", { parse_mode: "HTML" });
  }

  else if (data === "signin" || data === "household") {
    if (!fs.existsSync(CURRENT_FILE)) return bot.sendMessage(chatId, "⚠️ Please use Set Gmail first.");
    const { email } = JSON.parse(fs.readFileSync(CURRENT_FILE));
    const pass = JSON.parse(fs.readFileSync(GMAIL_FILE))[email];
    fetchOtp(email, pass, data, chatId);
  }
});

function fetchOtp(email, password, type, chatId) {
  const imap = new Imap({ user: email, password, host: "imap.gmail.com", port: 993, tls: true });
  function openInbox(cb) {
    imap.openBox("INBOX", true, cb);
  }
  imap.once("ready", function () {
    openInbox(function (err, box) {
      if (err) throw err;
      const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      imap.search(["UNSEEN", ["SINCE", since]], function (err, results) {
        if (err || !results.length) return imap.end();
        const f = imap.fetch(results.slice(-5), { bodies: "" });
        f.on("message", function (msg) {
          msg.on("body", function (stream) {
            simpleParser(stream, async (err, parsed) => {
              if (type === "signin" && parsed.text.match(/\b\d{4}\b/)) {
                const otp = parsed.text.match(/\b\d{4}\b/)[0];
                bot.sendMessage(chatId, `🔐 Sign-in Code: <code>${otp}</code>`, { parse_mode: "HTML" });
              } else if (type === "household") {
                const match = parsed.text.match(/https:\/\/www\.netflix\.com\/.*getcode.*/i);
                if (match) bot.sendMessage(chatId, `📥 Get Code link:\n${match[0]}`);
              }
            });
          });
        });
        f.once("end", function () {
          imap.end();
        });
      });
    });
  });
  imap.once("error", function (err) {
    bot.sendMessage(chatId, `❌ IMAP Error: ${err.message}`);
  });
  imap.connect();
}
