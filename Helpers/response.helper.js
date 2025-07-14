// SUCCESS RESPONSE
exports.success = (res, data = false) => {
  res.status(data.status || 200).json({
    success: true,
    data: data.data || {},
    count: data.count || 0,
    message: data.message || "data sent",
  });
};

// ERROR RESPONSE
exports.error = (res, data = false) => {
  res.status(data.status || 500).json({
    success: false,
    data: data.data || {},
    message: data.message || "Oops! something went wrong",
  });
};

// UNAUTHORIZED RESPONSE
exports.unauthorized = (res, data = false) => {
  res.status(data.status || 401).json({
    success: false,
    data: data.data || {},
    message: data.message || "unauthorized",
  });
};

// FORBIDDEN RESPONSE
exports.forbidden = (res, data = false) => {
  res.status(data.status || 403).json({
    success: false,
    data: data.data || {},
    message: data.message || "Forbidden",
  });
};

// BADREQUEST RESPONSE
exports.badRequest = (res, data = false) => {
  res.status(data.status || 400).json({
    success: false,
    data: data.data || {},
    message: data.message || "Bad Request",
  });
};
