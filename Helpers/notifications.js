const admin = require("firebase-admin");
const Logger = require("../Helpers/logger");

// Initialize Firebase Admin SDK with your service account credentials
const serviceAccount = require("../firebase-admin-sdk-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Function to send FCM notification
const sendNotification = async (userToken, title, body) => {
  const message = {
    notification: {
      title,
      body,
    },
    token: userToken,
  };

  try {
    const response = await admin.messaging().send(message);
  } catch (error) {
    Logger.error(
      error.message + "at sendNotification function " + "Notification.js"
    );
  }
};

module.exports = sendNotification;
