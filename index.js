// ✅ Netflix Bot with Licensing, Admin-only Gmail, Get Code Support, Clean Buttons

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Imap = require("imap");
const { simpleParser } = require("mailparser");
const fs = require("fs");
const path = require("path");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const ADMIN_IDS = process.env.ADMIN_IDS.split(",").map((id) => parseInt(id));
const GMAIL_FILE = "gmail.json";
const AUTH_FILE = "auth-store.json";

if (!fs.existsSync(GMAIL_FILE)) fs.writeFileSync(GMAIL_FILE, JSON.stringify({}));
if (!fs.existsSync(AUTH_FILE)) fs.writeFileSync(AUTH_FILE, JSON.stringify({ authorized: {}, keys: {} }));

const loadGmail = () => JSON.parse(fs.readFileSync(GMAIL_FILE));
const saveGmail = (data) => fs.writeFileSync(GMAIL_FILE, JSON.stringify(data));
const loadAuth = () => JSON.parse(fs.readFileSync(AUTH_FILE));
const saveAuth = (data) => fs.writeFileSync(AUTH_FILE, JSON.stringify(data));

// 🧠 Helper
const isAdmin = (id) => ADMIN_IDS.includes(id);
const isAuthorized = (id) => {
  const auth = loadAuth();
  return auth.authorized[id] && new Date(auth.authorized[id].expires) > new Date();
};

const startKeyboard = (id) => {
  let buttons = [
    [{ text: "🔐 Sign-in Code", callback_data: "sign" }, { text: "🏠 Household Access", callback_data: "household" }],
  ];
  if (isAdmin(id)) {
    buttons.push([
      { text: "📥 Set Gmail", callback_data: "setgmail" },
      { text: "📧 My Gmail", callback_data: "mygmail" },
      { text: "📤 Delete Gmail", callback_data: "deletegmail" },
    ]);
    buttons.push([
      { text: "🗝️ Generate Key", callback_data: "genkey" },
      { text: "👥 Userlist", callback_data: "userlist" },
    ]);
  } else {
    buttons.push([{ text: "🔓 Redeem Key", callback_data: "redeem" }]);
  }
  return { reply_markup: { inline_keyboard: buttons } };
};

bot.onText(/\/start/, (msg) => {
  const id = msg.from.id;
  const username = msg.from.username || msg.from.first_name;
  bot.sendMessage(id, `Hello @${username}!\nChoose what you want to do:`, startKeyboard(id));
});

bot.on("callback_query", async (query) => {
  const id = query.from.id;
  const username = query.from.username || query.from.first_name;
  const chatId = query.message.chat.id;
  const data = query.data;
  const gmailData = loadGmail();
  const auth = loadAuth();

  if (!isAdmin(id) && !isAuthorized(id) && data !== "redeem") {
    return bot.sendMessage(chatId, `🚫 You are not a member of this bot.\nPlease contact @Munnabhaiya_Official to get membership.`);
  }

  if (data === "sign" || data === "household") {
    const email = gmailData.email;
    if (!email) return bot.sendMessage(chatId, `⚠️ Please use Set Gmail first.`);
    const imap = new Imap({ user: email, password: gmailData.pass, host: 'imap.gmail.com', port: 993, tls: true });

    imap.once('ready', function () {
      imap.openBox('INBOX', true, function () {
        const delay = new Date() - 5 * 60 * 1000;
        imap.search(['UNSEEN', ['SINCE', new Date(delay)]], function (_, results) {
          if (!results || !results.length) {
            imap.end();
            return bot.sendMessage(chatId, `❌ No new messages found.`);
          }
          const f = imap.fetch(results.slice(-5), { bodies: "" });
          f.on("message", (msg) => {
            msg.on("body", (stream) => {
              simpleParser(stream, async (err, parsed) => {
                const subject = parsed.subject || "";
                const body = parsed.text || "";
                let responded = false;

                if (data === "sign" && /\b\d{4}\b/.test(body)) {
                  responded = true;
                  bot.sendMessage(chatId, `Hi @${username},\n🔐 Netflix OTP: ${body.match(/\b\d{4}\b/)[0]}`);
                } else if (data === "household" && /accountaccess/.test(body)) {
                  const link = body.match(/https:\/\/www\.netflix\.com\/accountaccess[^\s]+/);
                  if (link) {
                    responded = true;
                    bot.sendMessage(chatId, `Hi @${username},\n🏠 Netflix Household Link: ${link[0]}`);
                  }
                } else if (data === "household" && parsed.html && parsed.html.includes("Get Code")) {
                  const match = parsed.html.match(/<a[^>]*href=[\"']([^\"']+)[\"'][^>]*>\s*Get Code\s*<\/a>/i);
                  if (match && match[1]) {
                    responded = true;
                    bot.sendMessage(chatId, `Hi @${username},\n🔗 Get Code link:\n${match[1]}`);
                  }
                }

                if (!responded) {
                  bot.sendMessage(chatId, `❌ No valid Netflix info found.`);
                }
              });
            });
          });
          f.once("end", () => imap.end());
        });
      });
    });
    imap.connect();
  }

  else if (data === "setgmail") {
    if (!isAdmin(id)) return bot.sendMessage(chatId, `❌ Only admin can set Gmail.`);
    bot.sendMessage(chatId, `📥 Send Gmail and password (e.g. email@gmail.com|password):`);
    bot.once("message", (msg) => {
      const [email, pass] = msg.text.split("|");
      saveGmail({ email, pass });
      bot.sendMessage(chatId, `✅ Gmail saved: ${email}`);
    });
  }

  else if (data === "mygmail") {
    if (!isAdmin(id)) return bot.sendMessage(chatId, `❌ Only admin can view this.`);
    bot.sendMessage(chatId, `📧 Current Gmail: ${gmailData.email || "Not set"}`);
  }

  else if (data === "deletegmail") {
    if (!isAdmin(id)) return bot.sendMessage(chatId, `❌ Only admin can delete Gmail.`);
    saveGmail({});
    bot.sendMessage(chatId, `🗑 Gmail removed.`);
  }

  else if (data === "genkey") {
    if (!isAdmin(id)) return;
    const opts = {
      reply_markup: {
        inline_keyboard: [["1", "3", "6", "12"].map((m) => ({ text: `${m} months`, callback_data: `makekey_${m}` }))],
      },
    };
    bot.sendMessage(chatId, `🗝️ Choose duration for license key:`, opts);
  }

  else if (data.startsWith("makekey_")) {
    const months = parseInt(data.split("_")[1]);
    const key = `NETFLIX-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const expires = new Date();
    expires.setMonth(expires.getMonth() + months);
    auth.keys[key] = { duration: months, expires: expires.toISOString(), used: false };
    saveAuth(auth);
    bot.sendMessage(chatId, `✅ Key generated for ${months} months:\n🔑 ${key}`);
  }

  else if (data === "redeem") {
    bot.sendMessage(chatId, `🔑 Please send your license key:`);
    bot.once("message", (msg) => {
      const input = msg.text.trim();
      const found = auth.keys[input];
      if (found && !found.used) {
        auth.authorized[msg.from.id] = { username: msg.from.username, expires: found.expires };
        auth.keys[input].used = true;
        saveAuth(auth);
        bot.sendMessage(msg.chat.id, `✅ Key redeemed successfully!\nValid for: ${found.duration} months\nExpires on: ${found.expires}`);
      } else {
        bot.sendMessage(msg.chat.id, `❌ Invalid or already used key.`);
      }
    });
  }

  else if (data === "userlist") {
    if (!isAdmin(id)) return;
    const list = Object.entries(auth.authorized)
      .map(([uid, info]) => `👤 @${info.username} - Expires: ${info.expires}`)
      .join("\n");
    bot.sendMessage(chatId, list || "❌ No users found.");
  }
});
