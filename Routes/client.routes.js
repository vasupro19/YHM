const express = require("express");
const ClientController = require("../Controllers/client.controller");
const router = express.Router();
const { authJwt, authorize } = require("../Middleware/apiAuth.middleware");
const Validator = require("../Middleware/validator.middleware");
const clientValidator = require("../Validators/client.validator");

router
  .post("/", authJwt, Validator(clientValidator), ClientController.createClient)
  .get("/", authJwt, ClientController.getClients)
  .put("/:id", authJwt, ClientController.updateClient);

module.exports = router;
