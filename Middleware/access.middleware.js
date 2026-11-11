const Response = require('../Helpers/response.helper');
const { ADMIN_ROLE_ID } = require('../Constants/constant');

// authJwt puts the logged-in user's role id in req.query.user_role
const requireAdmin = (req, res, next) => {
  if (Number(req.query.user_role) !== ADMIN_ROLE_ID) {
    res.set('x-server-errortype', 'AccessDeniedException');
    return Response.unauthorized(res, {
      message: 'Access denied! User not authorized to access resource',
      status: 403
    });
  }
  next();
};

module.exports = { requireAdmin };
