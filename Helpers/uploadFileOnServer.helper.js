const fs = require('fs');
const path = require('path');

const uploadFileFromMulter = (file, folder) => {
  return new Promise((resolve, reject) => {
    try {
      if (!file) {
        return reject(new Error('No file provided'));
      }

      //   const allowedFileTypes = ['image/jpeg', 'image/png', 'application/pdf', 'image/jpg'];
      //   if (!allowedFileTypes.includes(file.mimetype)) {
      //     return reject(new Error('Unsupported file type'));
      //   }

      const uploadBasePath = path.join(__dirname, '..', 'File', folder.toLowerCase());

      if (!fs.existsSync(uploadBasePath)) {
        fs.mkdirSync(uploadBasePath, { recursive: true });
      }

      const extension = path.extname(file.originalname);
      const fileName = `${Math.floor(Math.random() * 1e9)}-${Date.now()}${extension}`;
      const fullPath = path.join(uploadBasePath, fileName);

      fs.writeFileSync(fullPath, file.buffer);

      const relativePath = path.join('File', folder.toLowerCase(), fileName);
      resolve(relativePath);
    } catch (error) {
      console.error('LocalUploadError:', error);
      reject(error);
    }
  });
};

const deleteFileFromServer = (relativeFilePath) => {
  return new Promise((resolve, reject) => {
    try {
      const fullPath = path.join(__dirname, '..', relativeFilePath);

      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        resolve(true);
      } else {
        resolve(false);
      }
    } catch (error) {
      reject(error);
    }
  });
};

const uploadBase64File = (base64String, folder) => {
  return new Promise((resolve, reject) => {
    try {
      if (!base64String) {
        return reject(new Error('No file data provided'));
      }

      const matches = base64String.match(/^data:(.+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        return reject(new Error('Invalid base64 format'));
      }

      const mimeType = matches[1];
      const base64Data = matches[2];
      const buffer = Buffer.from(base64Data, 'base64');

      const extension = mimeType.split('/')[1] || 'bin';
      const fileName = `${Math.floor(Math.random() * 1e9)}-${Date.now()}.${extension}`;

      const uploadDir = path.join(__dirname, '..', 'File', folder.toLowerCase());
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const filePath = path.join(uploadDir, fileName);
      fs.writeFileSync(filePath, buffer);

      const relativePath = path.join('File', folder.toLowerCase(), fileName).replace(/\\/g, '/');
      resolve(relativePath);
    } catch (error) {
      console.error('Base64UploadError:', error);
      reject(error);
    }
  });
};

module.exports = { uploadFileFromMulter, deleteFileFromServer, uploadBase64File };
