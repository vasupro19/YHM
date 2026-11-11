const express = require("express");
const ClientController = require("../Controllers/client.controller");
const { requireAdmin } = require('../Middleware/access.middleware');
const router = express.Router();
const { authJwt, authorize } = require("../Middleware/apiAuth.middleware");
const Validator = require("../Middleware/validator.middleware");
const clientValidator = require("../Validators/client.validator");

router
  .post("/", authJwt, requireAdmin, Validator(clientValidator), ClientController.createClient)
  .get("/", authJwt, requireAdmin, ClientController.getClients)
  .put("/:id", authJwt, requireAdmin, ClientController.updateClient);

module.exports = router;
