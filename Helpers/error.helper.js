/**
 *
 * @param {string} message 'Somthing went wrong !'
 * @param {string} name 'system'
 * @param {number} code 500
 * @param {string} header 'internalSystemError'
 * @returns {error} error error instance
 * @description generates a custom error with given inputs
 */

function generateCustomError(
  message = "Something went wrong !",
  name = "system",
  code = 500,
  header = "internalSystemError"
) {
  return new Promise((resolve, reject) => {
    let error = new Error(message || "Something went wrong !");
    error.name = name || "system";
    error.resCode = code || 500;
    error.resHeader = header;
    reject(error);
  });
}

module.exports = { generateCustomError };
