const TelegramBot = require("node-telegram-bot-api");
const User = require("../models/User");

const File = require("../models/File");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

bot.on("message", async (msg) => {
  if (!msg.document && !msg.photo && !msg.video) return;

  let fileId, thumbFileId = null, fileType, fileName, mimeType;

  if (msg.photo) {
    fileType = "photo";
    thumbFileId = msg.photo[0].file_id; // smallest
    fileId = msg.photo[msg.photo.length - 1].file_id; // largest
    fileName = "photo.jpg";
    mimeType = "image/jpeg";
  }

  if (msg.document) {
    fileType = "document";
    fileId = msg.document.file_id;
    fileName = msg.document.file_name;
    mimeType = msg.document.mime_type;
  }

  if (msg.video) {
    fileType = "video";
    fileId = msg.video.file_id;
    thumbFileId = msg.video.thumb?.file_id || null;
    fileName = msg.video.file_name || "video.mp4";
    mimeType = msg.video.mime_type;
  }

  await File.create({
    telegramId: msg.from.id,
    messageId: msg.message_id,
    fileId,
    thumbFileId,
    fileType,
    fileName,
    mimeType,
    date: new Date()
  });

  bot.sendMessage(msg.chat.id, "✅ File indexed.");
});


bot.onText(/\/start/, async (msg) => {
  const telegramId = msg.from.id;
  const username = msg.from.username || "no_username";

  await User.findOneAndUpdate(
    { telegramId },
    { telegramId, username },
    { upsert: true }
  );

  bot.sendMessage(
    msg.chat.id,
    `✅ Connected!\n\nYour Telegram ID:\n${telegramId}\n\nPaste this ID on the website to login.`
  );
});



