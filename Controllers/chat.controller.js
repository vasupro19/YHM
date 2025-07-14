const Response = require('../Helpers/response.helper');
const crudHelper = require('../Helpers/crud.helper');
const Logger = require('../Helpers/logger');
const controllerName = 'chat.controller';

// create room
const createRoom = async (req, res) => {
  try {
  } catch (error) {
    Logger.error(error.message + ' at createRoom function ' + controllerName);
    return Response.error(res, {
      data: [],
      message: error.message
    });
  }
};
