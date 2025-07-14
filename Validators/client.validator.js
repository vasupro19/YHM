const Joi = require("joi");

const clientValidator = Joi.object({
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  password: Joi.string().required(),
  phoneNumber: Joi.string().required(),
  address: Joi.string().required(),
  gst: Joi.string().optional().allow("", null),
  pan: Joi.string().optional().allow("", null),
});

module.exports = clientValidator;
