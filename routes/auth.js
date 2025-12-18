const express = require("express");
const passport = require("passport");
const User = require("../models/User");
const bcrypt = require("bcrypt");


const router = express.Router();

/* SIGNUP PAGE */
router.get("/signup", (req, res) => {
  res.render("auth/signup");
});

/* SIGNUP LOGIC */
router.post("/signup", async (req, res) => {
  try {
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    let username = req.body.username;
    console.log(username + " requested signup"+ hashedPassword); 
    await User.create({
      email: req.body.email,
      username: username,
      password: hashedPassword, 
      telegramId: req.body.telegramId || null
    });

    res.redirect("/login");
  } catch (err) {
  console.error("Signup error:", err);
  res.status(500).send(err.message);
}

});

/* LOGIN PAGE */
router.get("/login", (req, res) => {
  res.render("auth/login");
});

/* LOGIN LOGIC */

/* LOGIN LOGIC */
router.post(
  "/login",
  passport.authenticate("local", {
    failureRedirect: "/login"
  }),
  (req, res) => {
    res.redirect("/dashboard");
  }
);

/* LOGOUT */
router.get("/logout", (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    res.redirect("/login");
  });
});

module.exports = router;
    