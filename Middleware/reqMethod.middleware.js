const Response = require("../Helpers/response.helper");

// eslint-disable-next-line consistent-return
async function checkReqMethod(req, res, next) {
    const notAllowedMethod = ["TRACK", "TRACE"];
    if (notAllowedMethod.includes((req.method).toUpperCase())) {
        return Response.error(res, {
            status: 405,
            message: `${req.method} method not allowed.`,
        });
    }
    next();
}

module.exports = checkReqMethod;
