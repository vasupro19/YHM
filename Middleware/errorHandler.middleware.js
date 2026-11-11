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

    //? upload problems (wrong type, too big) are the user's to fix, so say what they are
    if (error?.status === 400 && error.message) {
      message = error.message;
      status = 400;
    }
    if (error?.code === 'LIMIT_FILE_SIZE') {
      message = 'The file is larger than 8 MB.';
      status = 400;
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
