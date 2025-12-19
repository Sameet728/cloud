const mongoose = require("mongoose");

const fileSchema = new mongoose.Schema({
  telegramId: Number,
  messageId: Number,
  fileId: String,
  thumbFileId: String,   // 🖼️ thumbnail
  fileType: String,
  fileSize: {
    type: Number, // bytes
    default: 0
  },
  fileName: String,
  mimeType: String,
  date: Date,
  folderId: {
  type: mongoose.Schema.Types.ObjectId,
  default: null
}

});

module.exports = mongoose.model("File", fileSchema);
