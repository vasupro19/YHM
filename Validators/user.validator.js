const Joi = require("joi");

const userSchema = Joi.object({
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  password: Joi.string().required(),
  roleId: Joi.number().required(),
  clientId: Joi.number().required(),
  departmentId: Joi.number().required(),
  phoneNumber: Joi.string().required(),
  whatsAppNo: Joi.string().required(),
});

module.exports = userSchema;
