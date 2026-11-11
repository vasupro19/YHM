const { createServer } = require('http');
const { Server } = require('socket.io');
const { testDatabaseConnection } = require('./Database/connection');

const app = require('./app');
const express = require('express');
const Logger = require('./Helpers/logger');
const { IST } = require('./Helpers/dateTime.helper');
const HandleError = require('./Middleware/errorHandler.middleware');
const path = require('path');

const server = createServer(app);

const { PORT, NODE_ENV } = process.env;

const httpServer = server.listen(PORT || 1310, async (error) => {
  // Logger.info(`Server started connection on port ${PORT || 9081}`);
  if (error) {
    Logger.error(error);
    process.exit(1);
  }
  try {
    testDatabaseConnection();
    console.log(`server started on port: [${PORT || 1310}] with [${NODE_ENV.toUpperCase()} --env] [${IST('date')} ${IST('time')}]`);
  } catch (connectionError) {
    console.log('Unable to connect --DATABASE, Killing app :/(', connectionError);
    Logger.error(connectionError?.stack);
    process.exit(1);
  }
});

// uploaded files can never run as a page: no sniffing, no scripts, sandboxed
app.use('/File', (req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'Cross-Origin-Resource-Policy': 'same-site' });
  next();
}, express.static(path.join(__dirname, 'File'), { index: false, dotfiles: 'deny' }));
//? routes
require('./Routes')();

//? error handler middleware

app.use(HandleError);
