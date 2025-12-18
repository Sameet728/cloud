const mongoose = require("mongoose");

const folderSchema = new mongoose.Schema({
  telegramId: {
    type: Number,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  parentFolderId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Folder", folderSchema);
