const Joi = require("joi");

const roleValidator = Joi.object({
  name: Joi.string().required(),
  clientId: Joi.number().required(),
});

module.exports = roleValidator;
