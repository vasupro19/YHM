const express = require("express");
const MenuController = require("../Controllers/menu.controller");
const router = express.Router();
const { authJwt, authorize } = require("../Middleware/apiAuth.middleware");

router
  .post("/", authJwt, MenuController.createMenu)
  .get("/menuByConfig", authJwt, MenuController.getUserMenu)
  .get("/", authJwt, MenuController.getAllMenu)
  .get("/clientMenuList", authJwt, MenuController.getClientMenuList);

module.exports = router;
