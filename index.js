// ✅ Netflix Bot with Licensing System + Gmail + Fixes

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Imap = require("imap");
const { simpleParser } = require("mailparser");
const fs = require("fs");
const crypto = require("crypto");

const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",") : [];
const GMAIL_FILE = "gmail-store.json";
const AUTH_FILE = "auth-store.json";

let gmailStore = {};
let authStore = { authorized: {}, keys: {} };

// Load Gmail and Auth stores
try { gmailStore = JSON.parse(fs.readFileSync(GMAIL_FILE, "utf-8")); } catch {}
try { authStore = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8")); } catch {}

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const saveAuth = () => fs.writeFileSync(AUTH_FILE, JSON.stringify(authStore, null, 2));
const isAuthorized = (id) => authStore.authorized[id] && new Date(authStore.authorized[id].expires) > new Date();

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const username = msg.from.username || msg.from.first_name;
  const isAdmin = ADMIN_IDS.includes(userId);

  const buttons = [[
    { text: "🔐 Sign-in Code", callback_data: "signin" },
    { text: "🏠 Household Access", callback_data: "household" }
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
  } else {
    buttons.push([{ text: "🔓 Redeem Key", callback_data: "redeem" }]);
  }

  bot.sendMessage(chatId, `Hello @${username}!\nChoose what you want to do:`, {
    reply_markup: {
      remove_keyboard: true,
      inline_keyboard: buttons
    }
  });
});

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id.toString();
  const username = query.from.username || query.from.first_name;
  const data = query.data;
  const isAdmin = ADMIN_IDS.includes(userId);

  if (!isAdmin && ["signin", "household"].includes(data)) {
    if (!isAuthorized(userId)) {
      return bot.sendMessage(chatId, "🚫 You are not a member of this bot.\nPlease contact @Munnabhaiya_Official to get membership.");
    }
  }

  if (data === "genkey") {
    return bot.sendMessage(chatId, "Select key duration:", {
      reply_markup: {
        inline_keyboard: [[
          { text: "1 Month", callback_data: "key_1" },
          { text: "3 Months", callback_data: "key_3" },
          { text: "6 Months", callback_data: "key_6" },
          { text: "12 Months", callback_data: "key_12" }
        ]]
      }
    });
  }

  if (data.startsWith("key_")) {
    const months = parseInt(data.split("_")[1]);
    const key = "NETFLIX-" + crypto.randomBytes(3).toString("hex").toUpperCase();
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + months);

    authStore.keys[key] = {
      duration: months,
      expires: expiry.toISOString(),
      used: false
    };
    saveAuth();
    return bot.sendMessage(chatId, `✅ Key generated: ${key}\nValid for: ${months} months`);
  }

  if (data === "userlist") {
  const entries = Object.entries(authStore.authorized);
  const list = entries.length
    ? entries.map(([id, u]) => `👤 @${u.username || "unknown"} (ID: ${id})\n⏳ Expires: ${u.expires}`).join("\n\n")
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
if (data === "add_user") {
  if (!isAdmin) return;
  bot.sendMessage(chatId, "📩 Send user ID and username like this:\n`123456789 username`", { parse_mode: "Markdown" });

  bot.once("message", (msg) => {
    const parts = msg.text.trim().split(" ");
    if (parts.length < 2) return bot.sendMessage(chatId, "⚠️ Invalid format.");

    const [id, uname] = parts;
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + 1); // default 1 month

    authStore.authorized[id] = {
      username: uname,
      expires: expiry.toISOString()
    };
    saveAuth();
    return bot.sendMessage(chatId, `✅ User @${uname} added successfully.`);
  });
}

if (data === "remove_user") {
  if (!isAdmin) return;
  bot.sendMessage(chatId, "❌ Send user ID to remove:");

  bot.once("message", (msg) => {
    const id = msg.text.trim();
    if (!authStore.authorized[id]) return bot.sendMessage(chatId, "⚠️ User not found.");

    delete authStore.authorized[id];
    saveAuth();
    return bot.sendMessage(chatId, `🗑️ User ID ${id} removed.`);
  });
}

  if (data === "redeem") {
    bot.sendMessage(chatId, "🔑 Please send your license key:");
    bot.once("message", (msg) => {
      const key = msg.text.trim();
      if (!authStore.keys[key]) return bot.sendMessage(chatId, "❌ Invalid key.");
      if (authStore.keys[key].used) return bot.sendMessage(chatId, "⚠️ This key has already been used.");

      const { duration, expires } = authStore.keys[key];
      authStore.authorized[userId] = { username, expires };
      authStore.keys[key].used = true;
      saveAuth();
      return bot.sendMessage(chatId, `✅ Key redeemed successfully!\nValid for: ${duration} months\nExpires on: ${expires}`);
    });
  }

  if (data === "setgmail") {
    if (!isAdmin) return;
    return bot.sendMessage(chatId, "📧 Send Gmail and App Password in this format:\nyouremail@gmail.com yourpassword");
  }

  if (data === "mygmail") {
    if (!isAdmin) return;
    const info = gmailStore[userId];
    if (!info) return bot.sendMessage(chatId, "⚠️ No Gmail is set.");
    return bot.sendMessage(chatId, `📧 Your saved Gmail: ${info.email}`);
  }

  if (data === "deletegmail") {
    if (!isAdmin) return;
    if (gmailStore[userId]) {
      delete gmailStore[userId];
      fs.writeFileSync(GMAIL_FILE, JSON.stringify(gmailStore, null, 2));
      return bot.sendMessage(chatId, "🗑️ Gmail deleted.");
    } else {
      return bot.sendMessage(chatId, "⚠️ No Gmail to delete.");
    }
  }

  if (data === "signin" || data === "household") {
    let info = gmailStore[userId];
    if (!info) {
      const adminGmail = Object.entries(gmailStore).find(([id]) => ADMIN_IDS.includes(id));
      if (adminGmail) info = adminGmail[1];
    }
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

        const searchCriteria = [["FROM", "Netflix"], ["SINCE", new Date(Date.now() - 24 * 60 * 60 * 1000)]];
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

                if (data === "signin" && !responded && body.includes("sign in to Netflix")) {
                  const codeMatch = body.match(/\b\d{4}\b/);
                  if (codeMatch) {
                    responded = true;
                    bot.sendMessage(chatId, `Hi @${username},\n🔐 Your Netflix OTP is: ${codeMatch[0]}`);
                  }
                }

                if (data === "household" && !responded) {
                  const linkMatch = body.match(/https:\/\/www\.netflix\.com\/accountaccess[^\s]+/);
                  if (linkMatch) {
                    responded = true;
                    return bot.sendMessage(chatId, `Hi @${username},\n🏠 Netflix Link:\n${linkMatch[0]}`);
                  }

                  const codeMatch = body.match(/\b\d{4}\b/);
                  if (!responded && codeMatch) {
                    responded = true;
                    return bot.sendMessage(chatId, `Hi @${username},\n🏠 Netflix Household OTP: ${codeMatch[0]}`);
                  }

                  if (!responded && parsed.html && parsed.html.includes("Get Code")) {
                    const buttonMatch = parsed.html.match(/<a[^>]*href=["']([^"']+)["'][^>]*>\s*Get Code\s*<\/a>/i);
                    if (buttonMatch && buttonMatch[1]) {
                      responded = true;
                      return bot.sendMessage(chatId, `Hi @${username},\n🔗 Get Code link:\n${buttonMatch[1]}`);
                    }
                  }
                }

                if (!responded) {
                  responded = true;
                  bot.sendMessage(chatId, "❌ No valid Netflix info found.");
                }
                imap.end();
              });
            });
          });

          f.once("error", function (err) {
            bot.sendMessage(chatId, `❌ Fetch Error: ${err.message}`);
            imap.end();
          });

          f.once("end", function () {
            console.log("✅ IMAP fetch complete.");
          });
        });
      });
    });

    imap.once("error", function (err) {
      bot.sendMessage(chatId, `❌ IMAP Error: ${err.message}`);
    });

    imap.connect();
  }
});

bot.on("message", (msg) => {
  const userId = msg.from.id.toString();
  const isAdmin = ADMIN_IDS.includes(userId);
  const text = msg.text;

  if (text.includes("@gmail.com") && text.split(" ").length === 2 && isAdmin) {
    const [email, password] = text.split(" ");
    gmailStore[userId] = { email, password };
    fs.writeFileSync(GMAIL_FILE, JSON.stringify(gmailStore, null, 2));
    return bot.sendMessage(msg.chat.id, `✅ Gmail set successfully: ${email}`);
  }
});
