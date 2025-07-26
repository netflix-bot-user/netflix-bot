require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Imap = require("imap");
const { simpleParser } = require("mailparser");
const fs = require("fs");

const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",") : [];
const GMAIL_FILE = "gmail-store.json";
let gmailStore = {};

// 🔄 Load saved Gmail accounts
try {
  gmailStore = JSON.parse(fs.readFileSync(GMAIL_FILE, "utf-8"));
} catch {
  gmailStore = {};
}

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// 🟢 /start command with inline buttons
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name;

  bot.sendMessage(chatId, `Hello @${username}!\nChoose what you want to fetch:`, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🔐 Sign-in Code", callback_data: "signin" },
          { text: "🏠 Household Access", callback_data: "household" }
        ],
        [
          { text: "📥 Set Gmail", callback_data: "setgmail" },
          { text: "📧 My Gmail", callback_data: "mygmail" },
          { text: "📤 Delete Gmail", callback_data: "deletegmail" }
        ]
      ]
    }
  });
});

// 📩 Handle inline button presses
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id.toString();
  const username = query.from.username || query.from.first_name;
  const data = query.data;
  const isAdmin = ADMIN_IDS.includes(userId);

  if (data === "setgmail") {
    if (!isAdmin) return bot.sendMessage(chatId, "❌ Only admin can set Gmail.");
    return bot.sendMessage(chatId, "📧 Send Gmail and App Password in this format:\nyouremail@gmail.com yourpassword");
  }

  if (data === "mygmail") {
    if (!isAdmin) return bot.sendMessage(chatId, "❌ Only admin can view this.");
    const info = gmailStore[userId];
    if (!info) return bot.sendMessage(chatId, "⚠️ No Gmail is set.");
    return bot.sendMessage(chatId, `📧 Your saved Gmail: ${info.email}`);
  }

  if (data === "deletegmail") {
    if (!isAdmin) return bot.sendMessage(chatId, "❌ Only admin can delete Gmail.");
    if (gmailStore[userId]) {
      delete gmailStore[userId];
      fs.writeFileSync(GMAIL_FILE, JSON.stringify(gmailStore, null, 2));
      return bot.sendMessage(chatId, "🗑️ Gmail deleted.");
    } else {
      return bot.sendMessage(chatId, "⚠️ No Gmail to delete.");
    }
  }

  if (data === "signin" || data === "household") {
    const info = gmailStore[userId];
    if (!info) return bot.sendMessage(chatId, "⚠️ Please use Set Gmail first.");

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
                } else if (data === "household" && !responded && body.includes("accountaccess")) {
                  const linkMatch = body.match(/https:\/\/www\.netflix\.com\/accountaccess[^\s]+/);
                  if (linkMatch) {
                    responded = true;
                    bot.sendMessage(chatId, `Hi @${username},\n🏠 Netflix Link:\n${linkMatch[0]}`);
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

// 📨 Handle Gmail input message
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const text = msg.text;
  const isAdmin = ADMIN_IDS.includes(userId);

  if (text.includes("@gmail.com") && text.split(" ").length === 2 && isAdmin) {
    const [email, password] = text.split(" ");
    gmailStore[userId] = { email, password };
    fs.writeFileSync(GMAIL_FILE, JSON.stringify(gmailStore, null, 2));
    return bot.sendMessage(chatId, `✅ Gmail set successfully: ${email}`);
  }
});
