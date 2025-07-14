const express = require("express");
const UserController = require("../Controllers/user.controller");
const router = express.Router();
const Validator = require("../Middleware/validator.middleware");
const userValidator = require("../Validators/user.validator");
const { authJwt, authorize } = require("../Middleware/apiAuth.middleware");

router
  .post("/", authJwt, Validator(userValidator), UserController.createUser)
  .post("/updateMenuConfig", authJwt, UserController.updateMenuConfig)
  .get("/", authJwt, UserController.getUsers)
  .get("/menuConfig", authJwt, UserController.getMenuConfig)
  .put("/:id", authJwt, UserController.updateUser);

module.exports = router;
