const express = require('express');
const CategoryController = require('../Controllers/category.controller');
const router = express.Router();
const { authJwt, authorize } = require('../Middleware/apiAuth.middleware');

const dynamicDbConnectionMiddleware = require('../Middleware/getDynamicConnection.middleware');
const Validator = require('../Middleware/validator.middleware');
const categoryValidator = require('../Validators/category.validator');

router
  .post('/', authJwt, dynamicDbConnectionMiddleware, Validator(categoryValidator), CategoryController.createCategory)
  .get('/', authJwt, dynamicDbConnectionMiddleware, CategoryController.getCategory)
  .put('/:id', authJwt, dynamicDbConnectionMiddleware, CategoryController.updateCategory);

module.exports = router;
