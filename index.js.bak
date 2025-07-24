const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
require("dotenv").config();

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const ADMIN_IDS = process.env.ADMIN_IDS.split(",").map(id => id.trim());
const GMAIL_STORE = "gmail_store.json";

// Load existing Gmail store or initialize
function loadGmailStore() {
  if (!fs.existsSync(GMAIL_STORE)) return {};
  return JSON.parse(fs.readFileSync(GMAIL_STORE));
}

function saveGmailStore(data) {
  fs.writeFileSync(GMAIL_STORE, JSON.stringify(data, null, 2));
}

function isAdmin(userId) {
  return ADMIN_IDS.includes(userId.toString());
}

function getUserGmail(userId) {
  const store = loadGmailStore();
  return store[userId] || null;
}

function setUserGmail(userId, email, password) {
  const store = loadGmailStore();
  store[userId] = { email, password };
  saveGmailStore(store);
}

function deleteUserGmail(userId) {
  const store = loadGmailStore();
  delete store[userId];
  saveGmailStore(store);
}

const inlineKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: "🔐 Sign-in Code", callback_data: "signin_code" },
        { text: "🏡 Household Access", callback_data: "household_access" }
      ],
      [
        { text: "📩 Set Gmail", callback_data: "set_gmail" },
        { text: "📨 My Gmail", callback_data: "my_gmail" },
        { text: "📮 Delete Gmail", callback_data: "delete_gmail" }
      ]
    ]
  }
};

bot.onText(/\/start/, (msg) => {
  const name = msg.from.username || msg.from.first_name || "there";
  bot.sendMessage(
    msg.chat.id,
    `Hello @${name}!\nChoose what you want to fetch:`,
    inlineKeyboard
  );
});

bot.on("callback_query", async (query) => {
  const userId = query.from.id;
  const chatId = query.message.chat.id;
  const username = query.from.username || query.from.first_name || "User";
  const data = query.data;

  if (data === "set_gmail") {
    if (!isAdmin(userId)) return bot.sendMessage(chatId, "❌ Only admins can use this command.");
    bot.sendMessage(chatId, "📧 Please send your Gmail and App Password in this format:\nyouremail@gmail.com yourpassword");
  }

  else if (data === "my_gmail") {
    if (!isAdmin(userId)) return bot.sendMessage(chatId, "❌ Only admins can use this command.");
    const gmail = getUserGmail(userId);
    if (gmail) {
      bot.sendMessage(chatId, `📨 Your saved Gmail: ${gmail.email}`);
    } else {
      bot.sendMessage(chatId, "❌ No Gmail found. Please set one first.");
    }
  }

  else if (data === "delete_gmail") {
    if (!isAdmin(userId)) return bot.sendMessage(chatId, "❌ Only admins can use this command.");
    deleteUserGmail(userId);
    bot.sendMessage(chatId, "✅ Gmail deleted successfully.");
  }

  else if (data === "signin_code") {
    bot.sendMessage(chatId, "⏳ Reading Gmail inbox...");
    // Add your logic here to fetch sign-in code
    bot.sendMessage(chatId, "❌ No valid Netflix info found.");
  }

  else if (data === "household_access") {
    bot.sendMessage(chatId, "⏳ Reading Gmail inbox...");
    // Add your logic here to fetch household access info
    bot.sendMessage(chatId, "❌ No valid Netflix info found.");
  }

  bot.answerCallbackQuery(query.id);
});

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text.trim();

  // Ignore commands
  if (text.startsWith("/")) return;

  if (isAdmin(userId)) {
    const parts = text.split(" ");
    if (parts.length === 2 && parts[0].includes("@gmail.com")) {
      const [email, password] = parts;
      setUserGmail(userId, email, password);
      bot.sendMessage(chatId, `✅ Gmail set: ${email}`);
    }
  }
});
