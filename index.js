// ✅ index.js – Updated for your requirements

const TelegramBot = require('node-telegram-bot-api');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const fs = require('fs');
require('dotenv').config();

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : [];

// Storage
let users = new Set();
let gmailData = null;
if (fs.existsSync('users.json')) users = new Set(JSON.parse(fs.readFileSync('users.json')));
if (fs.existsSync('gmail.json')) gmailData = JSON.parse(fs.readFileSync('gmail.json'));

// Helpers
const isAdmin = id => ADMIN_IDS.includes(id.toString());
const isAuthorized = id => users.has(id.toString()) || isAdmin(id);

const saveUsers = () => fs.writeFileSync('users.json', JSON.stringify([...users]));
const saveGmail = () => fs.writeFileSync('gmail.json', JSON.stringify(gmailData));

// UI
function getMenu(id) {
  const kb = [
    [{ text: '🔐 Sign-in Code', callback_data: 'sign' }, { text: '🏠 Household Access', callback_data: 'household' }],
  ];
  if (!isAdmin(id)) kb.push([{ text: '🔓 Redeem Key', callback_data: 'redeem' }]);
  if (isAdmin(id)) {
    kb.push([
      { text: '📩 Set Gmail', callback_data: 'set_gmail' },
      { text: '📨 My Gmail', callback_data: 'my_gmail' },
      { text: '🗑️ Delete Gmail', callback_data: 'delete_gmail' }
    ]);
    kb.push([
      { text: '🔑 Generate Key', callback_data: 'generate_key' },
      { text: '👥 Userlist', callback_data: 'userlist' }
    ]);
  }
  return { reply_markup: { inline_keyboard: kb, remove_keyboard: true } };
}

// /start handler
bot.onText(/\/start/, msg => {
  const id = msg.from.id;
  const name = msg.from.username || msg.from.first_name;
  if (!isAuthorized(id)) {
    return bot.sendMessage(id, '🚫 You are not a member. Please contact @Munnabhaiya_Official.');
  }
  bot.sendMessage(id, `Hello @${name}! Choose an option:`, getMenu(id));
});

// Callback logic
bot.on('callback_query', async query => {
  const id = query.from.id;
  const data = query.data;
  const chatId = query.message.chat.id;
  const name = query.from.username || query.from.first_name;

  if (!isAuthorized(id)) {
    return bot.sendMessage(chatId, '🚫 You are not a member. Please contact @Munnabhaiya_Official.');
  }

  // === Household Access ===
  if (data === 'household') {
    if (!gmailData) {
      return bot.sendMessage(chatId, '⚠️ Please set Gmail first.');
    }
    bot.sendMessage(chatId, '⌛ Reading Gmail...');
    const imap = new Imap({
      user: gmailData.email,
      password: gmailData.password,
      host: 'imap.gmail.com', port: 993, tls: true
    });
    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err, box) => {
        if (err) return bot.sendMessage(chatId, '❌ Inbox error');
        const f = imap.seq.fetch(`${box.messages.total}:*`, { bodies: '' });
        let sent = false;
        f.on('message', msg => {
          msg.on('body', stream => {
            simpleParser(stream, (err, parsed) => {
              if (sent) return;
              const html = parsed.html || '';
              const m = html.match(/<a[^>]+href=['"]([^'"]+)['"][^>]*>\s*(Yes, This Was Me|Get Code)\s*<\/a>/i);
              if (m && m[1]) {
                sent = true;
                return bot.sendMessage(chatId, `Hi @${name},\n🔗 Household Link:\n${m[1]}`);
              }
            });
          });
        });
        f.once('end', () => {
          if (!sent) bot.sendMessage(chatId, '❌ No valid Netflix info found.');
          imap.end();
        });
      });
    });
    imap.once('error', () => bot.sendMessage(chatId, '❌ IMAP Error'));
    imap.connect();
  }

  // === Userlist ===
  else if (data === 'userlist' && isAdmin(id)) {
    const rows = [
      [{ text: '➕ Add User', callback_data: 'add_user' },
       { text: '➖ Remove User', callback_data: 'remove_user' }]
    ];
    return bot.sendMessage(chatId, '👥 Manage Users:', { reply_markup: { inline_keyboard: rows } });
  }

  // === Add User ===
  else if (data === 'add_user' && isAdmin(id)) {
    bot.sendMessage(chatId, 'Send user Telegram ID to add:');
    bot.once('message', m => {
      const uid = m.text.trim();
      users.add(uid);
      saveUsers();
      bot.sendMessage(chatId, `✅ User ${uid} added.`);
    });
  }

  // === Remove User ===
  else if (data === 'remove_user' && isAdmin(id)) {
    bot.sendMessage(chatId, 'Send user Telegram ID to remove:');
    bot.once('message', m => {
      const uid = m.text.trim();
      users.delete(uid);
      saveUsers();
      bot.sendMessage(chatId, `🗑️ User ${uid} removed.`);
    });
  }

  // === (Other logic like sign, redeem, set_gmail etc remains same) ===
});
