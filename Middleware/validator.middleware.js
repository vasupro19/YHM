const Response = require("../Helpers/response.helper");

module.exports = (schema) => {
  return async (req, res, next) => {
    try {
      const validatedData = await schema.validateAsync(req.body, {
        abortEarly: false,
        stripUnknown: true,
      });
      req.body = validatedData;
      next();
    } catch (err) {
      return Response.badRequest(res, {
        message: err?.details?.[0]?.message || err.message,
      });
    }
  };
};
