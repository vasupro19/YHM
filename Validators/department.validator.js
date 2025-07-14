const Joi = require("joi");

const departmentValidator = Joi.object({
  name: Joi.string().required(),
});

module.exports = departmentValidator;
