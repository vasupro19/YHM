const express = require('express');
const helmet = require('helmet');
const xss = require('xss-clean');
const cookieParser = require('cookie-parser');
const cors = require('cors');
require('dotenv').config();

//? custom req middlewares
const ReqMethod = require('./Middleware/reqMethod.middleware');
const ReqLogger = require('./Middleware/reqLogger.middleware');
const checkReqMethod = require('./Middleware/reqMethod.middleware');
const bodyParser = require('body-parser');

const { apiLimiter } = require('./Middleware/rateLimit.middleware');

const app = express();
// behind nginx/a load balancer set TRUST_PROXY=1 so limits apply to the real visitor address
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
app.use(bodyParser.json({ limit: '10mb' }));

// ! request security middlewares
app.use(helmet());
app.use(apiLimiter);
app.use(xss());
app.use(
  cors({
    origin: process.env.CORS_URLS.split(', '),
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    exposedHeaders: ['x-server-errortype']
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(ReqMethod);
app.use(ReqLogger);
app.use(checkReqMethod);

module.exports = app;
