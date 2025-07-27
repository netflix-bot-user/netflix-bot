// ✅ Required Modules
const TelegramBot = require('node-telegram-bot-api');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const fs = require('fs');
require('dotenv').config();

// ✅ Environment Variables
const TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : [];
const bot = new TelegramBot(TOKEN, { polling: true });

// ✅ Database
let users = new Set();
let gmailData = null;
if (fs.existsSync('users.json')) users = new Set(JSON.parse(fs.readFileSync('users.json')));
if (fs.existsSync('gmail.json')) gmailData = JSON.parse(fs.readFileSync('gmail.json'));

// ✅ Helper Functions
function isAdmin(id) {
  return ADMIN_IDS.includes(id.toString());
}
function saveUsers() {
  fs.writeFileSync('users.json', JSON.stringify([...users]));
}
function saveGmail() {
  fs.writeFileSync('gmail.json', JSON.stringify(gmailData));
}

// ✅ UI Buttons
function getMainMenu(id) {
  const buttons = [
    [{ text: '🔐 Sign-in Code', callback_data: 'signin' }, { text: '🏠 Household Access', callback_data: 'household' }],
    [{ text: '🪪 Redeem Key', callback_data: 'redeem' }],
  ];
  if (isAdmin(id)) {
    buttons.push(
      [
        { text: '📩 Set Gmail', callback_data: 'set_gmail' },
        { text: '📨 My Gmail', callback_data: 'my_gmail' },
        { text: '🗑️ Delete Gmail', callback_data: 'delete_gmail' }
      ],
      [
        { text: '🔑 Generate Key', callback_data: 'generate_key' },
        { text: '👥 Userlist', callback_data: 'userlist' }
      ]
    );
  }
  return { reply_markup: { inline_keyboard: buttons } };
}

// ✅ Bot Start
bot.onText(/\/start/, (msg) => {
  const id = msg.from.id;
  const username = msg.from.username || msg.from.first_name;
  if (!users.has(id.toString()) && !isAdmin(id)) {
    return bot.sendMessage(id, '⛔ You are not a member of this bot.\nPlease contact @Munnabhaiya_Official to get membership.');
  }
  bot.sendMessage(id, `Hello @${username}!
Choose what you want to do:`, getMainMenu(id));
});

// ✅ Callback Query
bot.on('callback_query', async (query) => {
  const data = query.data;
  const id = query.from.id;
  const username = query.from.username || query.from.first_name;
  const chatId = query.message.chat.id;

  if (!users.has(id.toString()) && !isAdmin(id)) {
    return bot.sendMessage(id, '⛔ You are not a member of this bot.\nPlease contact @Munnabhaiya_Official to get membership.');
  }

  // ✅ Household Access Logic
  if (data === 'household') {
    if (!gmailData) return bot.sendMessage(chatId, '⚠️ Please use Set Gmail first.');
    bot.sendMessage(chatId, '⏳ Reading Gmail inbox...');
    const imap = new Imap({
      user: gmailData.email,
      password: gmailData.password,
      host: 'imap.gmail.com',
      port: 993,
      tls: true
    });

    function openInbox(cb) {
      imap.openBox('INBOX', true, cb);
    }

    imap.once('ready', function () {
      openInbox(function (err, box) {
        if (err) return bot.sendMessage(chatId, '❌ Failed to open inbox.');
        const f = imap.seq.fetch(`${box.messages.total}:*`, { bodies: '' });
        let sent = false;
        f.on('message', function (msg) {
          msg.on('body', function (stream) {
            simpleParser(stream, async (err, parsed) => {
              const html = parsed?.html || '';
              if (!sent) {
                const linkMatch = html.match(/<a[^>]+href=["']([^"']+)["'][^>]*>\s*(Yes, This Was Me|Get Code)\s*<\/a>/i);
                if (linkMatch && linkMatch[1]) {
                  sent = true;
                  return bot.sendMessage(chatId, `Hi @${username},\n🔗 Household Link: ${linkMatch[1]}`);
                }
              }
            });
          });
        });
        f.once('end', function () {
          if (!sent) bot.sendMessage(chatId, '❌ No valid Netflix info found.');
          imap.end();
        });
      });
    });

    imap.once('error', function (err) {
      bot.sendMessage(chatId, '❌ IMAP Error.');
    });

    imap.connect();
  }

  // ✅ Userlist Button with Inline Options
  if (data === 'userlist' && isAdmin(id)) {
    return bot.sendMessage(chatId, '👥 Manage Users:', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ Add User', callback_data: 'add_user' }, { text: '➖ Remove User', callback_data: 'remove_user' }]
        ]
      }
    });
  }

  // 🔁 TODO: Add rest of the command handling logic as needed (set_gmail, redeem, etc)
});
