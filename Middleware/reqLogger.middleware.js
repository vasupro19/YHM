const logger = require("../Helpers/logger");
const { IST } = require("../Helpers/dateTime.helper");

function reqLogger(req, res, next) {
  const formattedDate = IST();

  const ip =
    req.headers["x-forwarded-for"] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    req.connection.socket.remoteAddress;

  const { method, url, statusCode } = req;
  const log = `Request: [${formattedDate}] ${method}:${url} ${
    statusCode || ""
  } ${ip}`;
  logger.info(log);
  next();
}

module.exports = reqLogger;
