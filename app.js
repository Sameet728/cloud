require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const path = require("path");
const axios = require("axios");
const passport = require("passport");
const isLoggedIn = require("./middleware/isLoggedIn");
const Folder = require("./models/Folder");
const File = require("./models/File");
const crypto = require("crypto");


const app = express();

/* =========================
   BASIC EXPRESS MIDDLEWARE
========================= */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   SESSION (MUST COME FIRST)
========================= */
app.use(session({
  secret: process.env.SESSION_SECRET || "supersecretkey",
  resave: false,
  saveUninitialized: false
}));

/* =========================
   PASSPORT (ORDER MATTERS)
========================= */
require("./config/passport");   // define strategies FIRST
app.use(passport.initialize()); // THEN initialize
app.use(passport.session());    // THEN session support

/* =========================
   GLOBAL USER
========================= */
app.use((req, res, next) => {
  res.locals.currentUser = req.user;
  next();
});



// 🔐 ADD THIS HERE (TOP LEVEL)
function sanitizeFileName(name) {
  return name
    .replace(/[\r\n"]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}
async function getAllSubfolderIds(folderId, telegramId) {
  const Folder = require("./models/Folder");

  let ids = [folderId];
  const children = await Folder.find({
    parentFolderId: folderId,
    telegramId
  });

  for (const child of children) {
    const childIds = await getAllSubfolderIds(child._id, telegramId);
    ids = ids.concat(childIds);
  }

  return ids;
}


mongoose.connect(process.env.MONGO_URI);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));


require("./bot/bot");

async function buildBreadcrumb(folder) {
  const Folder = require("./models/Folder");
  const path = [];

  while (folder) {
    path.unshift(folder);
    folder = folder.parentFolderId
      ? await Folder.findById(folder.parentFolderId)
      : null;
  }

  return path;
}

const authRoutes = require("./routes/auth");
app.use("/", authRoutes);


app.get("/", (req, res) => {
  res.render("index");
});

app.get("/profile", isLoggedIn, (req, res) => {
  res.render("profile");
});

app.post("/profile/telegram", isLoggedIn, async (req, res) => {
  req.user.telegramId = Number(req.body.telegramId);
  await req.user.save();
  res.redirect("/dashboard");
});


app.get("/download/:id", isLoggedIn, async (req, res) => {
  if (!req.user.telegramId) return res.redirect("/");

  const File = require("./models/File");
  const axios = require("axios");

  const file = await File.findById(req.params.id);
  if (!file) return res.status(404).send("File not found");

  if (file.telegramId !== Number(req.user.telegramId)) {
    return res.status(403).send("Access denied");
  }

  const tgRes = await axios.get(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${file.fileId}`
  );

  const filePath = tgRes.data.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;

  const stream = await axios.get(fileUrl, { responseType: "stream" });

  const safeFileName = sanitizeFileName(file.fileName || "file");

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${safeFileName}"`
  );

  stream.data.pipe(res);
});



/* =========================
   REQUEST TELEGRAM VERIFY
========================= */
app.post("/telegram/request", isLoggedIn, async (req, res) => {
  const code = "TG-" + crypto.randomBytes(3).toString("hex").toUpperCase();

  req.user.telegramVerifyCode = code;
  req.user.telegramVerified = false;
  await req.user.save();

  res.json({ code });
});





app.post("/file/:id/delete", async (req, res) => {
  if (!req.user.telegramId) {
    return res.redirect("/");
  }

  const File = require("./models/File");
  const file = await File.findById(req.params.id);

  if (!file) {
    return res.status(404).send("File not found");
  }

  // 🔐 Access control
  if (file.telegramId !== Number(req.user.telegramId)) {
    return res.status(403).send("Access denied");
  }

  const TelegramBot = require("node-telegram-bot-api");
  const bot = new TelegramBot(process.env.BOT_TOKEN);

  try {
    // 🗑️ Delete message from Telegram
    await bot.deleteMessage(file.telegramId, file.messageId);

    // 🗑️ Delete metadata from DB
    await File.findByIdAndDelete(req.params.id);

    res.redirect("/dashboard");
  } catch (err) {
    console.error("Delete failed:", err.message);
    res.send("Unable to delete file. Telegram may restrict older messages.");
  }
});


app.get("/thumb/:id", async (req, res) => {
  if (!req.user.telegramId) return res.status(401).end();

  const File = require("./models/File");
  const file = await File.findById(req.params.id);

  if (!file || !file.thumbFileId) {
    return res.status(404).end();
  }

  if (file.telegramId !== Number(req.user.telegramId)) {
    return res.status(403).end();
  }

  const axios = require("axios");

  const tgRes = await axios.get(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${file.thumbFileId}`
  );

  const filePath = tgRes.data.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;

  const stream = await axios.get(fileUrl, { responseType: "stream" });

  res.setHeader("Content-Type", "image/jpeg");
  stream.data.pipe(res);
});

// DASHBOARD (Passport + Folder system)
app.get("/dashboard/:folderId?", isLoggedIn, async (req, res) => {

    if (!req.user.telegramVerified) {
    return res.redirect("/");
  }
  // 🚨 If Telegram ID not linked, force profile page
  if (!req.user.telegramId) {
    return res.redirect("/profile");
  }

  const telegramId = Number(req.user.telegramId);
  const folderId = req.params.folderId || null;

  // Current folder (if inside one)
  const currentFolder = folderId
    ? await Folder.findOne({ _id: folderId, telegramId })
    : null;

  // Child folders
  const folders = await Folder.find({
    telegramId,
    parentFolderId: folderId
  });

  // File filter
  const filter = {
    telegramId,
    folderId
  };

  // Optional file-type filter
  if (req.query.type) {
    filter.fileType = req.query.type;
  }

  // Files in current folder
  const files = await File.find(filter);

  // Breadcrumb
  const breadcrumb = currentFolder
    ? await buildBreadcrumb(currentFolder)
    : [];

  res.render("dashboard", {
    folders,
    files,
    currentFolder,
    breadcrumb
  });
});


app.post("/folder/create", isLoggedIn, async (req, res) => {
  const Folder = require("./models/Folder");

  await Folder.create({
    telegramId: Number(req.user.telegramId),
    name: req.body.name,
    parentFolderId: req.body.parentFolderId || null
  });

  res.redirect("back");
});



app.post("/file/:id/move", async (req, res) => {
  if (!req.user.telegramId) {
    return res.status(401).end();
  }

  const File = require("./models/File");
  const file = await File.findById(req.params.id);

  if (!file) return res.status(404).end();

  if (file.telegramId !== Number(req.user.telegramId)) {
    return res.status(403).end();
  }

  await File.findByIdAndUpdate(req.params.id, {
    folderId: req.body.folderId || null
  });

  res.json({ success: true });
});


app.get("/search", isLoggedIn, async (req, res) => {
  if (!req.user.telegramId) return res.redirect("/");

  const File = require("./models/File");
  const Folder = require("./models/Folder");

  const q = req.query.q || "";
  const telegramId = Number(req.user.telegramId);

  const files = await File.find({
    telegramId,
    fileName: { $regex: q, $options: "i" }
  });

  const folders = await Folder.find({
    telegramId,
    name: { $regex: q, $options: "i" }
  });

  res.render("dashboard", {
    currentFolder: null,
    breadcrumb: [],
    files,
    folders
  });
});


app.get("/preview/:id", isLoggedIn, async (req, res) => {
  if (!req.user.telegramId) return res.redirect("/");

  const File = require("./models/File");
  const axios = require("axios");

  const file = await File.findById(req.params.id);
  if (!file) return res.status(404).send("File not found");

  if (file.telegramId !== Number(req.user.telegramId)) {
    return res.status(403).send("Access denied");
  }

  // Only apply range logic for video
  const range = req.headers.range;

  // Get Telegram file path
  const tgRes = await axios.get(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${file.fileId}`
  );

  const filePath = tgRes.data.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;

  if (!range || file.fileType !== "video") {
    // Non-video or no range → normal preview
    const stream = await axios.get(fileUrl, { responseType: "stream" });

    res.setHeader("Content-Type", file.mimeType || "video/mp4");
    res.setHeader("Content-Disposition", "inline");

    return stream.data.pipe(res);
  }

  // ✅ VIDEO WITH RANGE SUPPORT
  const telegramRes = await axios.get(fileUrl, {
    responseType: "stream",
    headers: { Range: range }
  });

  res.status(206);
  res.setHeader("Content-Type", file.mimeType || "video/mp4");
  res.setHeader("Content-Disposition", "inline");

  // Forward important headers
  if (telegramRes.headers["content-range"]) {
    res.setHeader("Content-Range", telegramRes.headers["content-range"]);
  }
  if (telegramRes.headers["content-length"]) {
    res.setHeader("Content-Length", telegramRes.headers["content-length"]);
  }
  res.setHeader("Accept-Ranges", "bytes");

  telegramRes.data.pipe(res);
});



app.post("/files/bulk-move", async (req, res) => {
  const File = require("./models/File");

  await File.updateMany(
    {
      _id: { $in: req.body.ids },
      telegramId: Number(req.user.telegramId)
    },
    { folderId: req.body.folderId || null }
  );

  res.json({ success: true });
});

app.post("/files/bulk-delete", async (req, res) => {
  const File = require("./models/File");
  const TelegramBot = require("node-telegram-bot-api");
  const bot = new TelegramBot(process.env.BOT_TOKEN);

  const files = await File.find({
    _id: { $in: req.body.ids },
    telegramId: Number(req.user.telegramId)
  });

  for (const file of files) {
    try {
      await bot.deleteMessage(file.telegramId, file.messageId);
      await File.findByIdAndDelete(file._id);
    } catch {}
  }

  res.json({ success: true });
});

app.post("/folder/:id/delete-hard", async (req, res) => {
  if (!req.user.telegramId) {
    return res.redirect("/");
  }

  const Folder = require("./models/Folder");
  const File = require("./models/File");
  const TelegramBot = require("node-telegram-bot-api");

  const telegramId = Number(req.user.telegramId);
  const folderId = req.params.id;

  const folder = await Folder.findById(folderId);
  if (!folder || folder.telegramId !== telegramId) {
    return res.status(403).send("Access denied");
  }

  // 1️⃣ Collect all folders (recursive)
  const folderIds = await getAllSubfolderIds(folderId, telegramId);

  // 2️⃣ Collect all files inside these folders
  const files = await File.find({
    telegramId,
    folderId: { $in: folderIds }
  });

  const bot = new TelegramBot(process.env.BOT_TOKEN);

  // 3️⃣ Delete Telegram messages (files)
  for (const file of files) {
    try {
      await bot.deleteMessage(telegramId, file.messageId);
    } catch (err) {
      // Telegram may fail for old messages; continue safely
      console.warn("Telegram delete failed:", file.messageId);
    }
  }

  // 4️⃣ Delete file metadata
  await File.deleteMany({
    telegramId,
    folderId: { $in: folderIds }
  });

  // 5️⃣ Delete folders (deepest first)
  await Folder.deleteMany({
    telegramId,
    _id: { $in: folderIds }
  });

  res.redirect("/dashboard");
});









app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
