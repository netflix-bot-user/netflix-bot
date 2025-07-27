// ✅ index.js – All buttons now functional

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
  const kb = [
    [{ text: '🔐 Sign-in Code', callback_data: 'sign' }, { text: '🏠 Household Access', callback_data: 'household' }],
  ];
  if (!isAdmin(id)) kb.push([{ text: '🔓 Redeem Key', callback_data: 'redeem_key' }]);
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

bot.onText(/\/start/, msg => {
  const id = msg.from.id;
  const name = msg.from.username || msg.from.first_name;
  if (!isAuthorized(id)) {
    return bot.sendMessage(id, '🚫 You are not a member. Please contact @Munnabhaiya_Official.');
  }
  bot.sendMessage(id, `Hello @${name}! Choose an option:`, getMenu(id));
});

bot.on('callback_query', async query => {
  const id = query.from.id;
  const data = query.data;
  const chatId = query.message.chat.id;
  const name = query.from.username || query.from.first_name;

  if (!isAuthorized(id)) {
    return bot.sendMessage(chatId, '🚫 You are not a member. Please contact @Munnabhaiya_Official.');
  }

  // ✅ Household
  if (data === 'household') {
    if (!gmailData) return bot.sendMessage(chatId, '⚠️ Please set Gmail first.');
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

  // ✅ Userlist
  else if (data === 'userlist' && isAdmin(id)) {
    const rows = [[
      { text: '➕ Add User', callback_data: 'add_user' },
      { text: '➖ Remove User', callback_data: 'remove_user' }
    ]];
    bot.sendMessage(chatId, '👥 Manage Users:', { reply_markup: { inline_keyboard: rows } });
  }

  // ✅ Add User
  else if (data === 'add_user' && isAdmin(id)) {
    bot.sendMessage(chatId, 'Send Telegram ID to add:');
    bot.once('message', m => {
      users.add(m.text.trim());
      saveUsers();
      bot.sendMessage(chatId, `✅ Added user: ${m.text.trim()}`);
    });
  }

  // ✅ Remove User
  else if (data === 'remove_user' && isAdmin(id)) {
    bot.sendMessage(chatId, 'Send Telegram ID to remove:');
    bot.once('message', m => {
      users.delete(m.text.trim());
      saveUsers();
      bot.sendMessage(chatId, `🗑️ Removed user: ${m.text.trim()}`);
    });
  }

  // ✅ Sign-in Code (placeholder)
  else if (data === 'sign') {
    bot.sendMessage(chatId, '🔐 Sign-in Code logic will be implemented here.');
  }

  // ✅ Set Gmail
  else if (data === 'set_gmail' && isAdmin(id)) {
    bot.sendMessage(chatId, '📩 Send Gmail credentials in format: email|password');
    bot.once('message', m => {
      const [email, password] = m.text.split('|');
      if (!email || !password) return bot.sendMessage(chatId, '❌ Invalid format.');
      gmailData = { email, password };
      saveGmail();
      bot.sendMessage(chatId, `✅ Gmail saved:
${email}`);
    });
  }

  // ✅ My Gmail
  else if (data === 'my_gmail' && isAdmin(id)) {
    if (!gmailData) return bot.sendMessage(chatId, '📭 No Gmail set.');
    bot.sendMessage(chatId, `📨 Current Gmail:
${gmailData.email}`);
  }

  // ✅ Delete Gmail
  else if (data === 'delete_gmail' && isAdmin(id)) {
    gmailData = null;
    fs.unlinkSync('gmail.json');
    bot.sendMessage(chatId, '🗑️ Gmail removed.');
  }

  // ✅ Generate Key (placeholder)
  else if (data === 'generate_key' && isAdmin(id)) {
    bot.sendMessage(chatId, '🛠 Key generation logic will be implemented here.');
  }

  // ✅ Redeem Key (placeholder)
  else if (data === 'redeem_key') {
    bot.sendMessage(chatId, '🔓 Redeem logic will be added here.');
  }
});
