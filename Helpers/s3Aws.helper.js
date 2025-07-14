const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// Server Crads from Env
const client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Upload File In AWS...

/**
 *
 * @param {Binary file} file
 * @param {folder name string} folder
 * @param {universaly unique identification string } nameId
 * @returns
 */

const uploadFile = (base64Data, folder, nameId) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Add prefix if not present
      if (
        !base64Data.startsWith("data:image/jpeg") &&
        !base64Data.startsWith("data:image/png") &&
        !base64Data.startsWith("data:application/pdf")
      ) {
        reject(new Error("Unsupported file type"));
        return;
      }
      // Decode base64 data to binary
      const binaryData = Buffer.from(base64Data.split(",")[1], "base64");
      // Determine extension based on prefix
      let extension;
      if (base64Data.includes("data:image/jpeg")) {
        extension = "jpg";
      } else if (base64Data.includes("data:image/png")) {
        extension = "png";
      } else if (base64Data.includes("data:application/pdf")) {
        extension = "pdf";
      } else {
        reject(new Error("Unsupported file type"));
        return;
      }
      const fileName = `${folder.toLowerCase()}/${
        nameId || Math.floor(Math.random() * 1000000000)
      }-${Date.now()}.${extension}`;

      const ContentType =
        extension === "pdf" ? "application/pdf" : "image/" + extension;

      const command = new PutObjectCommand({
        Bucket: process.env.AWS_BUCKET,
        Key: fileName,
        Body: binaryData,
        ContentType: ContentType,
      });
      await client.send(command);
      resolve(fileName);
    } catch (error) {
      console.log("UploadError", error);
      reject(error);
    }
  });
};

// Get File From AWS...(URL FOR 60 MINTS)

const getTempUrl = async (fileName) => {
  return new Promise(async (resolve, reject) => {
    try {
      const command = new GetObjectCommand({
        Bucket: process.env.AWS_BUCKET,
        Key: fileName,
      });
      const url = await getSignedUrl(client, command, { expiresIn: 3600 });
      resolve(url);
    } catch (error) {
      console.log(error);
      reject(error);
    }
  });
};

const s3Delete = function (fileName) {
  return new Promise((resolve, reject) => {
    const deleteParams = {
      Bucket: process.env.AWS_BUCKET,
      Key: fileName,
    };

    const command = new DeleteObjectCommand(deleteParams);

    client.send(command, function (err, data) {
      if (err) {
        console.log(err);
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
};

module.exports = {
  uploadFile,
  getTempUrl,
  s3Delete,
};
