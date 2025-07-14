const Joi = require('joi');

const loginSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
    token: Joi.string().min(6).optional().allow(null)
});

module.exports = loginSchema;
