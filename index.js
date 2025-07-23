require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Imap = require("imap");
const { simpleParser } = require("mailparser");
const fs = require("fs");

// 🔒 Admin Telegram ID
const ADMIN_ID = process.env.ADMIN_ID;

// 📦 Gmail store file (userId -> gmail & password)
const GMAIL_FILE = "gmail-store.json";
let gmailStore = {};

try {
  gmailStore = JSON.parse(fs.readFileSync(GMAIL_FILE, "utf-8"));
} catch (err) {
  gmailStore = {};
}

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name;
  bot.sendMessage(chatId, `नमस्ते @${username}!\nकृपया एक विकल्प चुनें:`, {
    reply_markup: {
      keyboard: [
        [{ text: "🔐 Sign-in Code" }],
        [{ text: "🏠 Household Access" }],
      ],
      resize_keyboard: true,
    },
  });
});

// ✅ Set Gmail (Admin only)
bot.onText(/\/setgmail (.+) (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (userId != ADMIN_ID) return bot.sendMessage(chatId, "❌ आप इस command के लिए अधिकृत नहीं हैं।");

  const email = match[1];
  const password = match[2];

  gmailStore[userId] = { email, password };
  fs.writeFileSync(GMAIL_FILE, JSON.stringify(gmailStore, null, 2));

  bot.sendMessage(chatId, `✅ Gmail सेट कर दिया गया: *${email}*`, { parse_mode: "Markdown" });
});

// 🧾 My Gmail (Admin only)
bot.onText(/\/mygmail/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (userId != ADMIN_ID) return bot.sendMessage(chatId, "❌ आप इस command के लिए अधिकृत नहीं हैं।");

  const data = gmailStore[userId];
  if (!data) return bot.sendMessage(chatId, "⚠️ कोई Gmail सेट नहीं है।");

  bot.sendMessage(chatId, `📧 आपका सेट Gmail है: *${data.email}*`, { parse_mode: "Markdown" });
});

// ❌ Delete Gmail (Admin only)
bot.onText(/\/deletegmail/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (userId != ADMIN_ID) return bot.sendMessage(chatId, "❌ आप इस command के लिए अधिकृत नहीं हैं।");

  if (gmailStore[userId]) {
    delete gmailStore[userId];
    fs.writeFileSync(GMAIL_FILE, JSON.stringify(gmailStore, null, 2));
    bot.sendMessage(chatId, "🗑️ आपका Gmail हटा दिया गया है।");
  } else {
    bot.sendMessage(chatId, "⚠️ कोई Gmail सेट नहीं था।");
  }
});

// 📩 Handle Sign-in Code / Household
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || msg.from.first_name;
  const text = msg.text;

  if (text === "🔐 Sign-in Code" || text === "🏠 Household Access") {
    const userData = gmailStore[userId];
    if (!userData) {
      return bot.sendMessage(chatId, "⚠️ कृपया पहले /setgmail से Gmail सेट करें (Admin only)");
    }

    const { email, password } = userData;

    bot.sendMessage(chatId, `⏳ Gmail जाँचा जा रहा है...`);

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
        if (err) return bot.sendMessage(chatId, `❌ INBOX Error: ${err.message}`);

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

          f.on("message", function (msgFetch, seqno) {
            let responded = false;

            msgFetch.on("body", function (stream, info) {
              simpleParser(stream, async (err, parsed) => {
                if (err) {
                  if (!responded) bot.sendMessage(chatId, "❌ Parsing में error आया।");
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
                  bot.sendMessage(chatId, "❌ काम का Netflix ईमेल नहीं मिला।");
                  responded = true;
                }

                imap.end();
              });
            });
          });

          f.once("error", function (err) {
            bot.sendMessage(chatId, `❌ Fetch error: ${err.message}`);
            imap.end();
          });

          f.once("end", function () {
            imap.end();
          });
        });
      });
    });

    imap.once("error", function (err) {
      bot.sendMessage(chatId, `❌ IMAP error: ${err.message}`);
    });

    imap.once("end", function () {
      console.log("📴 IMAP बंद हुआ");
    });

    imap.connect();
  }
});
