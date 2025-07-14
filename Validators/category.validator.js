const Joi = require('joi');

const categoryValidator = Joi.object({
  name: Joi.string().required(),
  departmentId: Joi.number().required()
});

module.exports = categoryValidator;
