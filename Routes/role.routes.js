const express = require("express");
const RoleController = require("../Controllers/role.controller");
const { requireAdmin } = require('../Middleware/access.middleware');
const router = express.Router();
const { authJwt, authorize } = require("../Middleware/apiAuth.middleware");

// validator
const Validator = require("../Middleware/validator.middleware");
const roleValidator = require("../Validators/role.validator");

router
  .post("/", authJwt, requireAdmin, Validator(roleValidator), RoleController.createRole)
  .get("/", authJwt, RoleController.getRole)
  .get("/create/client", authJwt, RoleController.getRoleForCreateClient)
  .put("/:id", authJwt, requireAdmin, RoleController.updateRole);

module.exports = router;
