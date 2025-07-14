const Response = require('../Helpers/response.helper');
const Logger = require('../Helpers/logger');
const controllerName = 'fileOperation.controller';
const { uploadFileFromMulter, deleteFileFromServer, uploadBase64File } = require('../Helpers/uploadFileOnServer.helper');

// upload file from multer
const uploadFile = async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return Response.badRequest(res, {
        message: 'No file provided'
      });
    }

    const filePath = await uploadFileFromMulter(file, 'file');

    return Response.success(res, {
      data: filePath,
      message: 'File uploaded successfully'
    });
  } catch (error) {
    Logger.error(error.message + ' at uploadFile function ' + controllerName);
    return Response.error(res, {
      data: {},
      message: error.message
    });
  }
};

// upload file using base64
const uploadBase64 = async (req, res) => {
  try {
    const filePath = await uploadBase64File(req.body.file, req.body.documentName);
    return Response.success(res, {
      data: filePath,
      message: 'File Uploaded'
    });
  } catch (error) {
    Logger.error(error.message + ' at uploadBase64 function ' + controllerName);
    return Response.error(res, {
      data: {},
      message: error.message
    });
  }
};

const deleteFile = async (req, res) => {
  try {
    const filePath = req.body.filePath;
    await deleteFileFromServer(filePath);
    return Response.success(res, {
      data: {},
      message: 'File deleted successfully'
    });
  } catch (error) {
    Logger.error(error.message + ' at deleteFile function ' + controllerName);
    return Response.error(res, {
      data: {},
      message: error.message
    });
  }
};

module.exports = {
  uploadFile,
  uploadBase64,
  deleteFile
};
