const express = require('express');
const TaskController = require('../Controllers/task.controller');
const router = express.Router();
const { authJwt, authorize } = require('../Middleware/apiAuth.middleware');
const upload = require('../Helpers/multer.helper');

const dynamicDbConnectionMiddleware = require('../Middleware/getDynamicConnection.middleware');
const Validator = require('../Middleware/validator.middleware');
const taskValidator = require('../Validators/task.validator');

// sanatizedQuery
const sanitizedQuery = require('../Helpers/sanitizedQuery.helper');
const taskConfig = require('../controllerConfig/task.config');

router
  .post('/', authJwt, dynamicDbConnectionMiddleware, Validator(taskValidator), TaskController.createTask)
  .get('/', authJwt, dynamicDbConnectionMiddleware, sanitizedQuery(taskConfig), TaskController.getTask)
  .put('/:id', authJwt, dynamicDbConnectionMiddleware, TaskController.updateTask);

module.exports = router;
