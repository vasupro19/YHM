const Response = require('../Helpers/response.helper');
const { IST } = require('../Helpers/dateTime.helper');
const { generateCustomError } = require('../Helpers/error.helper');
const AuthHelper = require('../Helpers/auth.helper');
const Logger = require('../Helpers/logger');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const { ACCESS_TOKEN_SECRET, REFRESH_TOKEN_SECRET, ACCESS_TOKEN_EXPIRY, REFRESH_TOKEN_EXPIRY, APP_NAME } = process.env;

const login = async (req, res, next) => {
  try {
    const query = {};
    if (req.body?.email) query.email = req.body.email;
    else if (req.body?.password) query.password = req.body.password;
    else return Response.badRequest(res, { message: 'Invalid Inputs' });

    const user = await prisma.user.findUnique({
      where: query,
      include: { role: true }
    });

    if (!user) {
      return Response.badRequest(res, { message: 'Invalid User' });
    }

    if (!user.active) {
      return Response.badRequest(res, { message: 'User Is In Active' });
    }

    await AuthHelper.compareHash(req.body.password, user.password);

    const accessToken = await AuthHelper.generateToken({ id: user.id, role: user.roleId }, ACCESS_TOKEN_EXPIRY, ACCESS_TOKEN_SECRET);

    const refreshToken = await AuthHelper.generateToken({ id: user.id, role: user.roleId }, REFRESH_TOKEN_EXPIRY, REFRESH_TOKEN_SECRET);

    res.cookie(APP_NAME, JSON.stringify({ refreshToken }), {
      secure: true,
      httpOnly: true,
      expires: IST('date', 7, 'days'),
      sameSite: 'none'
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken }
    });

    Response.success(res, {
      data: { accessToken, user, refreshToken },
      message: 'Logged-In Successfully'
    });
  } catch (error) {
    Logger.error(error.message + ' at login function auth controller');
    next(error);
  }
};

const generateTokens = async (req, res, next) => {
  try {
    let token = JSON.parse(req.cookies[APP_NAME])?.refreshToken;
    if (!token) {
      return Response.badRequest(res, {
        message: 'Invalid Inputs'
      });
    }

    const verify = await AuthHelper.verifyToken(token, REFRESH_TOKEN_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: verify.id, refreshToken: token, active: true }
    });

    if (!user) {
      return Response.badRequest(res, {
        message: 'Invalid Token or User Blocked'
      });
    }

    const accessToken = await AuthHelper.generateToken(
      { id: user.id, name: user.name, role: user.roleId },
      ACCESS_TOKEN_EXPIRY,
      ACCESS_TOKEN_SECRET
    );

    return Response.success(res, { data: [{ accessToken }] });
  } catch (error) {
    Logger.error(error.message + ' at generate tokens function auth controller');
    next(error);
  }
};

const logout = async (req, res, next) => {
  try {
    const { auth_user_id } = req.query;
    if (!auth_user_id)
      return Response.error(res, {
        message: 'auth_user_id is required.',
        statusCode: 400
      });

    await prisma.user.update({
      where: { id: parseInt(auth_user_id) },
      data: { refreshToken: '', updatedAt: new Date() }
    });

    res.clearCookie(APP_NAME, {
      secure: true,
      httpOnly: true,
      sameSite: 'none'
    });
    return Response.success(res, { message: 'User logged out!' });
  } catch (error) {
    return Response.error(res, {
      message: error.message
    });
  }
};

const getUser = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: parseInt(req.query.auth_user_id) },
      include: { role: true }
    });

    if (!user) {
      return Response.badRequest(res, {
        message: 'user not found'
      });
    }

    Response.success(res, {
      data: { user, date: IST() },
      message: 'Logged-In User Data Found'
    });
  } catch (error) {
    console.log(error);
    next(error);
  }
};

module.exports = { login, logout, generateTokens, getUser };
