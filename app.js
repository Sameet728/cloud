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
const multer = require("multer");
const fs = require("fs");
const TelegramBot = require("node-telegram-bot-api");
const os = require("os");
const Busboy = require("busboy");
const Share = require("./models/Share");
const FolderShare = require("./models/FolderShare");



const upload = multer({
  dest: os.tmpdir(),
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024
  }
});




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


async function getAllFilesInFolder(folderId, telegramId) {
  const folders = await Folder.find({ parentFolderId: folderId, telegramId });
  const files = await File.find({ folderId, telegramId });

  let allFiles = [...files];

  for (const f of folders) {
    const nested = await getAllFilesInFolder(f._id, telegramId);
    allFiles.push(...nested);
  }

  return allFiles;
}




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

  const axiosInstance = axios.create({
  timeout: 0,
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
  decompress: false,
  headers: {
    Connection: "keep-alive"
  }
});

const stream = await axiosInstance.get(fileUrl, {
  responseType: "stream"
});



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

  const axiosInstance = axios.create({
  timeout: 0,
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
  decompress: false,
  headers: {
    Connection: "keep-alive"
  }
});

const stream = await axiosInstance.get(fileUrl, {
  responseType: "stream"
});



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

    // 🔢 TOTAL FILE COUNT
  const totalFiles = await File.countDocuments({ telegramId });

  // 💾 TOTAL STORAGE USED
  const stats = await File.aggregate([
    { $match: { telegramId } },
    {
      $group: {
        _id: null,
        totalSize: { $sum: "$fileSize" }
      }
    }
  ]);

  const totalStorage = stats[0]?.totalSize || 0;
  console.log("Total storage (bytes):", totalStorage);

  res.render("dashboard", {
    folders,
    files,
    currentFolder,
    breadcrumb,
    totalFiles,
    totalStorage
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

  const telegramId = Number(req.user.telegramId);
  const q = req.query.q || "";

  const files = await File.find({
    telegramId,
    fileName: { $regex: q, $options: "i" }
  });

  const folders = await Folder.find({
    telegramId,
    name: { $regex: q, $options: "i" }
  });

  const totalFiles = await File.countDocuments({ telegramId });

  const stats = await File.aggregate([
    { $match: { telegramId } },
    { $group: { _id: null, totalSize: { $sum: "$fileSize" } } }
  ]);

  const totalStorage = stats[0]?.totalSize || 0;

  res.render("dashboard", {
    currentFolder: null,
    breadcrumb: [],
    files,
    folders,
    totalFiles,
    totalStorage
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
    const axiosInstance = axios.create({
  timeout: 0,
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
  decompress: false,
  headers: {
    Connection: "keep-alive"
  }
});

const stream = await axiosInstance.get(fileUrl, {
  responseType: "stream"
});



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




app.post("/upload-stream", isLoggedIn, (req, res) => {
  if (!req.user.telegramVerified) {
    return res.status(403).send("Telegram not verified");
  }

  const telegramId = req.user.telegramId;
  const bot = new TelegramBot(process.env.BOT_TOKEN);

  const busboy = Busboy({ headers: req.headers });

  let uploadPromise;
  let currentFolderId = null;

  let originalFileName = "";
  let detectedMime = "";
  let totalSize = 0;
  let fileType = "document";

  busboy.on("field", (name, value) => {
    if (name === "folderId") {
      currentFolderId = value || null;
    }
  });

  busboy.on("file", (fieldname, file, info) => {
    const { filename, mimeType } = info;

    originalFileName = filename;
    detectedMime = mimeType || "application/octet-stream";

    // count size
    file.on("data", chunk => {
      totalSize += chunk.length;
    });

    // decide fileType BEFORE sending
    if (detectedMime.startsWith("image/")) {
      fileType = "photo";
      uploadPromise = bot.sendPhoto(telegramId, file);
    } 
    else if (detectedMime.startsWith("video/")) {
      fileType = "video";
      uploadPromise = bot.sendVideo(telegramId, file);
    } 
    else {
      fileType = "document";
      uploadPromise = bot.sendDocument(
        telegramId,
        file,
        {},
        { filename: originalFileName }
      );
    }
  });

  busboy.on("finish", async () => {
    try {
      const message = await uploadPromise;

      let fileId, thumbFileId = null;

      if (fileType === "photo") {
        thumbFileId = message.photo[0].file_id;
        fileId = message.photo[message.photo.length - 1].file_id;
      }
      else if (fileType === "video") {
        fileId = message.video.file_id;
        thumbFileId = message.video.thumb?.file_id || null;
      }
      else {
        fileId = message.document.file_id;
      }

      await File.create({
        telegramId,
        folderId: currentFolderId,
        messageId: message.message_id,

        fileId,
        thumbFileId,

        fileType,
        fileName: originalFileName,   // ✅ FIXED
        mimeType: detectedMime,        // ✅ FIXED
        fileSize: totalSize,            // ✅ FIXED

        date: new Date()
      });

      res.status(200).end();
    } catch (err) {
      console.error(err);
      res.status(500).send("Upload failed");
    }
  });

  req.pipe(busboy);
});



app.post("/file/:id/share", isLoggedIn, async (req, res) => {
  const file = await File.findById(req.params.id);

  if (!file || file.telegramId !== Number(req.user.telegramId)) {
    return res.status(403).json({ error: "Access denied" });
  }

  let share = await Share.findOne({ fileId: file._id });

  // 🔁 If already shared → just return existing link
  if (share && share.isActive) {
    return res.json({
      link: `${req.protocol}://${req.get("host")}/s/${share.token}`,
      active: true
    });
  }

  // ♻️ If exists but disabled → re-enable
  if (share && !share.isActive) {
    share.isActive = true;
    await share.save();

    return res.json({
      link: `${req.protocol}://${req.get("host")}/s/${share.token}`,
      active: true
    });
  }

  // 🆕 Create new share only if none exists
  const token = crypto.randomBytes(16).toString("hex");

  share = await Share.create({
    fileId: file._id,
    token
  });

  res.json({
    link: `${req.protocol}://${req.get("host")}/s/${token}`,
    active: true
  });
});

app.post("/file/:id/unshare", isLoggedIn, async (req, res) => {
  const Share = require("./models/Share");
  const File = require("./models/File");

  const file = await File.findById(req.params.id);

  if (!file || file.telegramId !== Number(req.user.telegramId)) {
    return res.status(403).json({ error: "Access denied" });
  }

  await Share.findOneAndUpdate(
    { fileId: file._id },
    { isActive: false }
  );

  res.json({ success: true });
});





app.get("/s/:token", async (req, res) => {
  const Share = require("./models/Share");
  const File = require("./models/File");
  const axios = require("axios");

  const share = await Share.findOne({
    token: req.params.token,
    isActive: true
  }).populate("fileId");

  if (!share) return res.status(404).send("Invalid or expired link");

  const file = share.fileId;

  const tgRes = await axios.get(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${file.fileId}`
  );

  const filePath = tgRes.data.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;

  const axiosInstance = axios.create({
  timeout: 0,
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
  decompress: false,
  headers: {
    Connection: "keep-alive"
  }
});

const stream = await axiosInstance.get(fileUrl, {
  responseType: "stream"
});



  res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    file.fileType === "photo" || file.fileType === "video"
      ? "inline"
      : `attachment; filename="${file.fileName}"`
  );

  stream.data.pipe(res);
});



app.post("/share/:token/revoke", isLoggedIn, async (req, res) => {
  const Share = require("./models/Share");

  await Share.findOneAndUpdate(
    { token: req.params.token },
    { isActive: false }
  );

  res.json({ success: true });
});

app.post("/folder/:id/unshare", isLoggedIn, async (req, res) => {
  const folder = await Folder.findById(req.params.id);

  if (!folder || folder.telegramId !== Number(req.user.telegramId)) {
    return res.status(403).json({ error: "Access denied" });
  }

  // Disable folder share
  await FolderShare.findOneAndUpdate(
    { folderId: folder._id },
    { isActive: false }
  );

  // 🔥 DISABLE ALL FILE SHARES INSIDE
  const files = await getAllFilesInFolder(folder._id, folder.telegramId);

  await Share.updateMany(
    { fileId: { $in: files.map(f => f._id) } },
    { isActive: false }
  );

  res.json({ success: true });
});






app.post("/folder/:id/share", isLoggedIn, async (req, res) => {
  const folder = await Folder.findById(req.params.id);

  if (!folder || folder.telegramId !== Number(req.user.telegramId)) {
    return res.status(403).json({ error: "Access denied" });
  }

  let folderShare = await FolderShare.findOne({ folderId: folder._id });

  if (!folderShare) {
    folderShare = await FolderShare.create({
      folderId: folder._id,
      token: crypto.randomBytes(16).toString("hex"),
      isActive: true
    });
  } else {
    folderShare.isActive = true;
    await folderShare.save();
  }

  // 🔥 SHARE ALL FILES INSIDE FOLDER
  const files = await getAllFilesInFolder(folder._id, folder.telegramId);

  for (const file of files) {
    let fileShare = await Share.findOne({ fileId: file._id });

    if (!fileShare) {
      await Share.create({
        fileId: file._id,
        token: crypto.randomBytes(16).toString("hex"),
        isActive: true
      });
    } else {
      fileShare.isActive = true;
      await fileShare.save();
    }
  }

  res.json({
    link: `${req.protocol}://${req.get("host")}/sf/${folderShare.token}`
  });
});



app.get("/sf/:token", async (req, res) => {
  const FolderShare = require("./models/FolderShare");
  const Folder = require("./models/Folder");
  const File = require("./models/File");
  const Share = require("./models/Share");
  const crypto = require("crypto");

  const share = await FolderShare.findOne({
    token: req.params.token,
    isActive: true
  });

  if (!share) {
    return res.status(404).send("❌ Link expired or disabled");
  }

  const folder = await Folder.findById(share.folderId);
  if (!folder) return res.status(404).send("Folder not found");

  const telegramId = folder.telegramId;

  // 🔁 Recursive collector (SAFE)
  async function collect(folderId) {
    const folders = await Folder.find({
      parentFolderId: folderId,
      telegramId
    });

    const files = await File.find({
      folderId,
      telegramId
    });

    let allFolders = [...folders];
    let allFiles = [...files];

    for (const f of folders) {
      const nested = await collect(f._id);
      allFolders.push(...nested.folders);
      allFiles.push(...nested.files);
    }

    return { folders: allFolders, files: allFiles };
  }

  const data = await collect(folder._id);

  // 🔑 Ensure every file has a share token (SAFE OBJECTS)
  const filesWithShare = [];

  for (const file of data.files) {
    let fileShare = await Share.findOne({ fileId: file._id ,isActive: true});

    if (!fileShare) {
      continue;
    }

    filesWithShare.push({
      ...file.toObject(),
      share: {
        token: fileShare.token
      }
    });
  }

  res.render("shared/folder", {
    rootFolder: folder,
    folders: data.folders,
    files: filesWithShare
  });
});




app.get("/s/file/:token/preview", async (req, res) => {
  const Share = require("./models/Share");
  const axios = require("axios");

  const share = await Share.findOne({
    token: req.params.token,
    isActive: true
  }).populate("fileId");

  if (!share) return res.status(404).send("Invalid link");

  const file = share.fileId;

  const range = req.headers.range;

  // Get Telegram file path
  const tgRes = await axios.get(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${file.fileId}`
  );

  const filePath = tgRes.data.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;

  // 🔹 NON-VIDEO OR NO RANGE → NORMAL STREAM
  if (!range || file.fileType !== "video") {
    const stream = await axios.get(fileUrl, {
      responseType: "stream"
    });

    res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", "inline");

    return stream.data.pipe(res);
  }

  // 🔹 VIDEO WITH RANGE SUPPORT
  const telegramRes = await axios.get(fileUrl, {
    responseType: "stream",
    headers: {
      Range: range
    }
  });

  res.status(206);
  res.setHeader("Content-Type", file.mimeType || "video/mp4");
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("Accept-Ranges", "bytes");

  if (telegramRes.headers["content-range"]) {
    res.setHeader("Content-Range", telegramRes.headers["content-range"]);
  }

  if (telegramRes.headers["content-length"]) {
    res.setHeader("Content-Length", telegramRes.headers["content-length"]);
  }

  telegramRes.data.pipe(res);
});



app.get("/s/file/:token/download", async (req, res) => {
  const share = await Share.findOne({
    token: req.params.token,
    isActive: true
  }).populate("fileId");

  if (!share) return res.status(404).send("Invalid link");

  const file = share.fileId;

  const tgRes = await axios.get(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${file.fileId}`
  );

  const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${tgRes.data.result.file_path}`;

  const stream = await axios.get(fileUrl, { responseType: "stream" });

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${file.fileName}"`
  );

  stream.data.pipe(res);
});












app.listen(4000, () => {
  console.log("Server running on http://localhost:4000");
});
