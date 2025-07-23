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

// 🟢 Start button with custom keyboard
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name;

  bot.sendMessage(chatId, `नमस्ते @${username}!\nबॉट में नीचे दिए गए विकल्पों से काम करें:`, {
    reply_markup: {
      keyboard: [
        [{ text: "🔐 Sign-in Code" }, { text: "🏠 Household Access" }],
        [{ text: "📥 Set Gmail" }, { text: "📧 My Gmail" }, { text: "📤 Delete Gmail" }],
      ],
      resize_keyboard: true,
    },
  });
});

// 📩 Handle all button-based input
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const username = msg.from.username || msg.from.first_name;
  const text = msg.text;

  const isAdmin = ADMIN_IDS.includes(userId);

  // 📥 Set Gmail button
  if (text === "📥 Set Gmail") {
    if (!isAdmin) return bot.sendMessage(chatId, "❌ केवल Admin ही Gmail सेट कर सकता है।");
    bot.sendMessage(chatId, "✉️ कृपया अपना Gmail और App Password इस format में भेजें:\n`youremail@gmail.com yourpassword`", {
      parse_mode: "Markdown",
    });
    return;
  }

  // 📧 My Gmail
  if (text === "📧 My Gmail") {
    if (!isAdmin) return bot.sendMessage(chatId, "❌ केवल Admin ही देख सकता है।");
    const data = gmailStore[userId];
    if (!data) return bot.sendMessage(chatId, "⚠️ कोई Gmail सेट नहीं है।");
    return bot.sendMessage(chatId, `📧 आपका सेट Gmail है: *${data.email}*`, { parse_mode: "Markdown" });
  }

  // 📤 Delete Gmail
  if (text === "📤 Delete Gmail") {
    if (!isAdmin) return bot.sendMessage(chatId, "❌ केवल Admin ही हटा सकता है।");
    if (gmailStore[userId]) {
      delete gmailStore[userId];
      fs.writeFileSync(GMAIL_FILE, JSON.stringify(gmailStore, null, 2));
      return bot.sendMessage(chatId, "🗑️ आपका Gmail हटा दिया गया है।");
    } else {
      return bot.sendMessage(chatId, "⚠️ कोई Gmail सेट नहीं था।");
    }
  }

  // Gmail details save
  if (text.includes("@gmail.com") && text.split(" ").length === 2 && isAdmin) {
    const [email, password] = text.split(" ");
    gmailStore[userId] = { email, password };
    fs.writeFileSync(GMAIL_FILE, JSON.stringify(gmailStore, null, 2));
    return bot.sendMessage(chatId, `✅ Gmail सेट कर दिया गया: *${email}*`, { parse_mode: "Markdown" });
  }

  // 🔐 OTP / Link Fetching
  if (text === "🔐 Sign-in Code" || text === "🏠 Household Access") {
    const userData = gmailStore[userId];
    if (!userData) return bot.sendMessage(chatId, "⚠️ कृपया पहले 📥 Set Gmail का उपयोग करें।");

    const { email, password } = userData;
    bot.sendMessage(chatId, "⏳ Gmail inbox पढ़ा जा रहा है...");

    const imap = new Imap({
      user: email,
      password: password,
      host: "imap.gmail.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });

    imap.once("ready", function () {
      imap.openBox("INBOX", false, function (err, box) {
        if (err) {
          bot.sendMessage(chatId, `❌ INBOX Error: ${err.message}`);
          imap.end();
          return;
        }

        const searchCriteria = [["FROM", "Netflix"], ["SINCE", new Date(Date.now() - 24 * 60 * 60 * 1000)]];
        const fetchOptions = { bodies: ["HEADER", "TEXT"], struct: true };

        imap.search(searchCriteria, function (err, results) {
          if (err || results.length === 0) {
            bot.sendMessage(chatId, "❌ Netflix से कोई मेल नहीं मिला।");
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
                  bot.sendMessage(chatId, "❌ मेल पढ़ने में error आया।");
                  responded = true;
                  imap.end();
                  return;
                }

                const body = parsed.text || "";

                if (text === "🔐 Sign-in Code" && !responded && body.includes("sign in to Netflix")) {
                  const codeMatch = body.match(/\b\d{4}\b/);
                  if (codeMatch) {
                    responded = true;
                    bot.sendMessage(chatId, `👋 Hi @${username},\n🔐 आपका Netflix OTP है: *${codeMatch[0]}*`, {
                      parse_mode: "Markdown",
                    });
                  }
                } else if (text === "🏠 Household Access" && !responded && body.includes("accountaccess")) {
                  const linkMatch = body.match(/https:\/\/www\.netflix\.com\/accountaccess[^\s]+/);
                  if (linkMatch) {
                    responded = true;
                    bot.sendMessage(chatId, `👋 Hi @${username},\n🏠 Netflix Link:\n${linkMatch[0]}`);
                  }
                }

                if (!responded) {
                  responded = true;
                  bot.sendMessage(chatId, "❌ उपयोगी Netflix जानकारी नहीं मिली।");
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
            console.log("📥 Email fetch complete. IMAP disconnected.");
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
