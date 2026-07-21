const nodemailer = require("nodemailer");
require('dotenv').config()


//para envio de correos desde aws
const transporter = nodemailer.createTransport({
  host: 'email-smtp.us-east-1.amazonaws.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.SES_USER,
    pass: process.env.SES_PASSWORD
  }
});


/*
//para envio de correos desde localhost
let transporter = nodemailer.createTransport({
    host: process.env.MAILHOST,
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.MAIL, // generated ethereal user
        pass: process.env.PASSMAIL, // generated ethereal password
    },
    tls: {
    rejectUnauthorized: false  // <-- ignora certificado autofirmado
  }
});
*/

/*
let transporter = nodemailer.createTransport({
    host: process.env.MAILHOST,
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.MAIL, // generated ethereal user
        pass: process.env.PASSMAIL, // generated ethereal password
    }
});
*/

module.exports = transporter;
