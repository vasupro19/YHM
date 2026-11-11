const Joi = require("joi");

const userSchema = Joi.object({
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).max(72).required(),
  roleId: Joi.number().required(),
  clientId: Joi.number().allow(null).optional(),
  departmentId: Joi.number().allow(null).optional(),
  phoneNumber: Joi.string().required(),
  whatsAppNo: Joi.string().allow('', null).optional(),
});

module.exports = userSchema;
