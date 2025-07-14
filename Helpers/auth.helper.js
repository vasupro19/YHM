const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { generateCustomError } = require("./error.helper");

/**
 * @description generates hashed password for plain password
 * @param password string: password provided by user
 * @returns  hashed password || rejected promise
 */
async function generateHash(password) {
  return new Promise(async (resolve, reject) => {
    try {
      const saltRounds = 12;
      const plainPassword = password;
      let hashedPassword;
      hashedPassword = await bcrypt.hash(plainPassword, saltRounds);
      resolve(hashedPassword);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * @description generates json web token for provided user with expiry time
 * @param user {object} user object
 * @param time token expiry time {'1h', '1M', 60*60}
 * @param secret secret key to sign jwt
 * @returns jwt || rejected promise
 */
async function generateToken(data, time, secret) {
  return new Promise(async (resolve, reject) => {
    try {
      const token = jwt.sign(data, secret, { expiresIn: time });
      resolve(token);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * @description generates json web token for provided user with expiry time
 * @param token jwt token
 * @param secret jwt secret
 * @returns Promise (data || rejected promise)
 */
async function verifyToken(token, secret) {
  return new Promise(async (resolve, reject) => {
    try {
      let data = jwt.verify(token, secret);
      if (data?.expired) {
        return reject(
          await generateCustomError(
            "token expired !",
            "auth_token_error",
            401,
            "authTokenExpired"
          )
        );
      }
      resolve(data);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * @description extracts Bearer token from request headers
 * @param req req object
 * @returns Promise (token || rejected promise)
 */
function extractToken(req) {
  return new Promise(async (resolve, reject) => {
    try {
      //? checking if auth header exists
      if (!("authorization" in req.headers))
        await generateCustomError(
          "malformed authorization !",
          "auth_error",
          400,
          "invalidHeader"
        );

      let { authorization: token } = req.headers;

      //? checking if header value contains Bearer
      if (!token.startsWith("Bearer"))
        await generateCustomError(
          "malformed authorization !",
          "auth_error",
          401,
          "noBearer"
        );

      token = token.split(" ")[1];

      resolve(token);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * @description compares provided hash with user password
 * @param userPassword string: password provided by user
 * @param hash string: password hash from database
 * @returns Promise (true || rejected promise)
 */
async function compareHash(userPassword, hash) {
  return new Promise(async (resolve, reject) => {
    try {
      const match = await bcrypt.compare(userPassword, hash);
      if (match) resolve(true);

      await generateCustomError(
        "incorrect username or password",
        "auth_error",
        401,
        "invalidCredentials"
      );
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  generateHash,
  generateToken,
  verifyToken,
  extractToken,
  compareHash,
};
