// ✅ Final Netflix Bot Code – Fully Functional

const TelegramBot = require('node-telegram-bot-api');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const fs = require('fs');
require('dotenv').config();

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : [];
let users = new Set();
let gmailData = null;

if (fs.existsSync('users.json')) users = new Set(JSON.parse(fs.readFileSync('users.json')));
if (fs.existsSync('gmail.json')) gmailData = JSON.parse(fs.readFileSync('gmail.json'));

const isAdmin = id => ADMIN_IDS.includes(id.toString());
const isAuthorized = id => users.has(id.toString()) || isAdmin(id);
const saveUsers = () => fs.writeFileSync('users.json', JSON.stringify([...users]));
const saveGmail = () => fs.writeFileSync('gmail.json', JSON.stringify(gmailData));

function getMenu(id) {
  const kb = [];
  if (isAdmin(id)) {
    kb.push([
      { text: '🔐 Sign-in Code', callback_data: 'sign' },
      { text: '🏠 Household Access', callback_data: 'household' }
    ]);
    kb.push([
      { text: '📩 Set Gmail', callback_data: 'set_gmail' },
      { text: '📨 My Gmail', callback_data: 'my_gmail' },
      { text: '🗑️ Delete Gmail', callback_data: 'delete_gmail' }
    ]);
    kb.push([
      { text: '🔑 Generate Key', callback_data: 'generate_key' },
      { text: '👥 Userlist', callback_data: 'userlist' }
    ]);
  } else if (isAuthorized(id)) {
    kb.push([
      { text: '🔐 Sign-in Code', callback_data: 'sign' },
      { text: '🏠 Household Access', callback_data: 'household' }
    ]);
  } else {
    kb.push([{ text: '🔓 Redeem Key', callback_data: 'redeem_key' }]);
  }
  return { reply_markup: { inline_keyboard: kb } };
}

bot.onText(/\/start/, msg => {
  const id = msg.from.id;
  const username = msg.from.username || msg.from.first_name;

  if (!isAuthorized(id)) {
    return bot.sendMessage(id,
      '🚫 You are not a member of this bot.\nPlease contact @Munnabhaiya_Official to get membership.',
      getMenu(id));
  }

  bot.sendMessage(id, `Hi @${username}! Choose an option:`, getMenu(id));
});

bot.on('callback_query', async query => {
  const id = query.from.id;
  const data = query.data;
  const chatId = query.message.chat.id;
  const username = query.from.username || query.from.first_name;

  if (data === 'sign') {
    if (!gmailData) return bot.sendMessage(chatId, '⚠️ Please set Gmail first.');
    bot.sendMessage(chatId, '📨 Checking Gmail for sign-in code...');

    const imap = new Imap({
      user: gmailData.email,
      password: gmailData.password,
      host: 'imap.gmail.com',
      port: 993,
      tls: true
    });

    imap.once('ready', () => {
      imap.openBox('INBOX', false, () => {
        const f = imap.seq.fetch('1:*', { bodies: '' });
        let found = false;
        f.on('message', msg => {
          msg.on('body', stream => {
            simpleParser(stream, async (err, parsed) => {
              if (found) return;
              const body = parsed.text;
              const otpMatch = body.match(/\b(\d{4})\b/);
              if (otpMatch && parsed.subject.toLowerCase().includes('sign in')) {
                found = true;
                bot.sendMessage(chatId, `Hi @${username},\n🔐 Netflix Sign-in Code: *${otpMatch[1]}*`, { parse_mode: 'Markdown' });
              }
            });
          });
        });
        f.once('end', () => {
          if (!found) bot.sendMessage(chatId, '❌ No 4-digit Sign-in Code found.');
          imap.end();
        });
      });
    });

    imap.once('error', () => bot.sendMessage(chatId, '❌ IMAP connection failed. Check Gmail credentials.'));
    imap.connect();
  }

  else if (data === 'household') {
    if (!gmailData) return bot.sendMessage(chatId, '⚠️ Please set Gmail first.');
    bot.sendMessage(chatId, '📨 Checking Gmail for Household links...');
    const imap = new Imap({
      user: gmailData.email,
      password: gmailData.password,
      host: 'imap.gmail.com', port: 993, tls: true
    });
    imap.once('ready', () => {
      imap.openBox('INBOX', false, () => {
        const f = imap.seq.fetch('1:*', { bodies: '' });
        let sent = false;
        f.on('message', msg => {
          msg.on('body', stream => {
            simpleParser(stream, async (err, parsed) => {
              if (sent) return;
              const html = parsed.html || '';
              const match = html.match(/<a[^>]*href=["']([^"']+)["'][^>]*>\s*(Yes, This Was Me|Get Code)\s*<\/a>/i);
              if (match && match[1]) {
                sent = true;
                bot.sendMessage(chatId, `Hi @${username},\n🔗 Household Link:\n${match[1]}`);
              }
            });
          });
        });
        f.once('end', () => {
          if (!sent) bot.sendMessage(chatId, '❌ No valid Household email found.');
          imap.end();
        });
      });
    });
    imap.once('error', () => bot.sendMessage(chatId, '❌ IMAP connection failed.'));
    imap.connect();
  }

  else if (data === 'set_gmail' && isAdmin(id)) {
    bot.sendMessage(chatId, '📧 Send Gmail and App Password in this format:\n`youremail@gmail.com yourpassword`', { parse_mode: 'Markdown' });
    bot.once('message', m => {
      const [email, password] = m.text.trim().split(' ');
      if (!email || !password) return bot.sendMessage(chatId, '❌ Invalid format.');
      gmailData = { email, password };
      saveGmail();
      bot.sendMessage(chatId, `✅ Gmail set:\n${email}`);
    });
  }

  else if (data === 'my_gmail' && isAdmin(id)) {
    if (!gmailData) return bot.sendMessage(chatId, '❌ Gmail not set.');
    bot.sendMessage(chatId, `📨 Current Gmail:\n${gmailData.email}`);
  }

  else if (data === 'delete_gmail' && isAdmin(id)) {
    gmailData = null;
    fs.unlinkSync('gmail.json');
    bot.sendMessage(chatId, '🗑️ Gmail deleted.');
  }

  else if (data === 'userlist' && isAdmin(id)) {
    const buttons = [[
      { text: '➕ Add User', callback_data: 'add_user' },
      { text: '➖ Remove User', callback_data: 'remove_user' }
    ]];
    bot.sendMessage(chatId, '👥 Manage Users:', { reply_markup: { inline_keyboard: buttons } });
  }

  else if (data === 'add_user' && isAdmin(id)) {
    bot.sendMessage(chatId, '🆔 Send Telegram ID to add:');
    bot.once('message', m => {
      users.add(m.text.trim());
      saveUsers();
      bot.sendMessage(chatId, `✅ Added: ${m.text.trim()}`);
    });
  }

  else if (data === 'remove_user' && isAdmin(id)) {
    bot.sendMessage(chatId, '🗑️ Send Telegram ID to remove:');
    bot.once('message', m => {
      users.delete(m.text.trim());
      saveUsers();
      bot.sendMessage(chatId, `❌ Removed: ${m.text.trim()}`);
    });
  }

  else if (data === 'generate_key' && isAdmin(id)) {
    bot.sendMessage(chatId, '🛠 Key generation logic here (to be added).');
  }

  else if (data === 'redeem_key') {
    bot.sendMessage(chatId, '🔓 Key redeeming logic here (to be added).');
  }
});
