const Joi = require('joi');

const taskValidator = Joi.object({
  taskTitle: Joi.string().required(),
  raisedTo: Joi.number().required(),
  departmentId: Joi.number().required(),
  closeDate: Joi.string().required(),
  categoryId: Joi.number(),
  closeDate: Joi.string(),
  taskBody: Joi.string()
}).unknown(true);

module.exports = taskValidator;
