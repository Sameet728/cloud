const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  email: {
  type: String,
  default: null
},
  telegramId: {
    type: Number,
    default: null
  }
});

module.exports = mongoose.model("User", userSchema);
