const Joi = require("joi");

const roleValidator = Joi.object({
  name: Joi.string().required(),
  clientId: Joi.number().allow(null).optional(),
});

module.exports = roleValidator;
