const nodeMailer = require("nodemailer");

async function sendEmailWithNodemailer(req, res, emailData) {
  try {
    const transporter = nodeMailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true, // Use SSL/TLS
      auth: {
        user: process.env.EMAIL_ID, // Use environment variables
        pass: process.env.EMAIL_PASS, // Use environment variables
      },
      // TLS settings may not be necessary or can be configured based on Gmail's requirements
    });
    const info = await transporter.sendMail(emailData);
    console.log(`Message sent: ${info.response}`);
    return info; // Resolve the promise with the info object
  } catch (error) {
    console.log(`Problem sending email: ${error.message}`);
    throw error; // Throw the error to be caught and handled by the calling function
  }
}

module.exports = {
  sendEmailWithNodemailer,
};
