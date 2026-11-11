const express = require("express");
const AuthController = require("../Controllers/auth.controller");
const Validator = require("../Middleware/validator.middleware");
const loginValidator = require("../Validators/login.validator");
const { authJwt, authorize } = require("../Middleware/apiAuth.middleware");

const { loginLimiter, resetLimiter } = require("../Middleware/rateLimit.middleware");

const router = express.Router();

router
  .get("/", AuthController.generateTokens)
  .get("/logout", authJwt, AuthController.logout)
  .post("/login", loginLimiter, Validator(loginValidator), AuthController.login)
  .post("/forgot-password", resetLimiter, AuthController.forgotPassword)
  .post("/reset-password", resetLimiter, AuthController.resetPassword)
  .post("/change-password", authJwt, AuthController.changePassword)
  .get("/user", authJwt, AuthController.getUser);

module.exports = router;
