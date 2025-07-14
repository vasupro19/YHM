const express = require('express');
const DepartmentController = require('../Controllers/department.controller');
const router = express.Router();
const { authJwt, authorize } = require('../Middleware/apiAuth.middleware');

const dynamicDbConnectionMiddleware = require('../Middleware/getDynamicConnection.middleware');
const Validator = require('../Middleware/validator.middleware');
const departmentValidator = require('../Validators/department.validator');

// sanatizedQuery
const sanitizedQuery = require('../Helpers/sanitizedQuery.helper');
const departmentConfig = require('../controllerConfig/department.config');

router
  .post('/', authJwt, dynamicDbConnectionMiddleware, Validator(departmentValidator), DepartmentController.createDepartment)
  .get('/', authJwt, dynamicDbConnectionMiddleware, sanitizedQuery(departmentConfig), DepartmentController.getDepartment)
  .put('/:id', authJwt, dynamicDbConnectionMiddleware, DepartmentController.updateDepartment);

module.exports = router;
