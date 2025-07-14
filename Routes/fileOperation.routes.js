const express = require('express');
const fileOperationController = require('../Controllers/fileOperation.controller');
const router = express.Router();
const { authJwt, authorize } = require('../Middleware/apiAuth.middleware');

const upload = require('../Helpers/multer.helper');

router
  .post('/formWeb', authJwt, fileOperationController.uploadBase64)
  .post('/', authJwt, upload.single('file'), fileOperationController.uploadFile)
  .get('/delete/file', authJwt, fileOperationController.deleteFile);

module.exports = router;
