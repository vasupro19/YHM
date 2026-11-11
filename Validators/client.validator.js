const Joi = require("joi");

const clientValidator = Joi.object({
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).max(72).required(),
  phoneNumber: Joi.string().required(),
  address: Joi.string().required(),
  gst: Joi.string().optional().allow("", null),
  pan: Joi.string().optional().allow("", null),
});

module.exports = clientValidator;
