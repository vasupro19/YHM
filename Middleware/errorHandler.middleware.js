const Response = require("../Helpers/response.helper");
const Logger = require("../Helpers/logger");

const errorList = [
  "NON_UNIQUE",
  "auth_error",
  "auth_token_error",
  "user_not_found",
  "org_not_registered",
  "account_blocked",
  "system",
  "bad_request",
  "account_deactive",
];
/**
 *
 * @param {error} error instance
 * @returns void
 */

function handleError(error, req, res, next) {
  try {
    if (error?.stack) {
      Logger.error(error.stack);
    } else {
      Logger.error(error);
    }

    let message = null;
    let status = 500;

    //? checking for known errors
    if (error?.name && errorList.includes(error.name)) {
      message = error.message;
      status = error.resCode || status;
    }

    //? checking if a res header is set for error
    if (error?.resHeader) res.set("x-server-errortype", error.resHeader);

    Response.error(res, {
      status: status,
      message: message || "Something went wrong !",
    });
    next();
  } catch (error) {
    console.log("error in handle error");
    console.log(error);
    Response.error(res, { message: "Something went wrong !" });
    next();
  }
}

module.exports = handleError;
