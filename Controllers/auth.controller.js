const Response = require('../Helpers/response.helper');
const { IST } = require('../Helpers/dateTime.helper');
const { generateCustomError } = require('../Helpers/error.helper');
const AuthHelper = require('../Helpers/auth.helper');
const Logger = require('../Helpers/logger');
const { publicUser } = require('../Helpers/safeUser.helper');
const crypto = require('crypto');
const { sendMail } = require('../Helpers/mailer');

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const validPassword = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 72;
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
      data: { accessToken, user: publicUser(user), refreshToken },
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
      data: { user: publicUser(user), date: IST() },
      message: 'Logged-In User Data Found'
    });
  } catch (error) {
    console.log(error);
    next(error);
  }
};

// always answers the same way, so nobody can use it to find out which emails have accounts
const forgotPassword = async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const reply = () => Response.success(res, { message: 'If that email has an account, a reset link has been sent.' });
    if (!email) return reply();

    const user = await prisma.user.findFirst({ where: { email, active: true } });
    if (!user) return reply();

    const token = crypto.randomBytes(32).toString('hex');
    await prisma.user.update({ where: { id: user.id }, data: { passwordResetHash: sha256(token), passwordResetExpires: new Date(Date.now() + 30 * 60 * 1000) } });

    const link = `${process.env.APP_URL || 'http://localhost:3001'}/reset-password?token=${token}`;
    try {
      await sendMail({
      to: user.email,
      subject: 'Reset your YHM password',
      text: `Hello ${user.name},\n\nUse this link to choose a new password. It works for 30 minutes:\n${link}\n\nIf you did not ask for this, ignore this email.`,
      html: `<p>Hello ${user.name},</p><p><a href="${link}">Choose a new password</a>. The link works for 30 minutes.</p><p>If you did not ask for this, ignore this email.</p>`
      });
    } catch (mailError) {
      // the person sees the same reply either way; the server log tells the owner what went wrong
      Logger.error(`password reset email to ${user.email} failed: ${mailError.message}`);
    }
    return reply();
  } catch (error) {
    Logger.error(error.message + ' at forgotPassword function auth controller');
    next(error);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const { token, password } = req.body || {};
    if (!token || typeof token !== 'string') return Response.badRequest(res, { message: 'This reset link is not valid.' });
    if (!validPassword(password)) return Response.badRequest(res, { message: 'Choose a password of 8 to 72 characters.' });

    const user = await prisma.user.findFirst({ where: { passwordResetHash: sha256(token), passwordResetExpires: { gt: new Date() }, active: true } });
    if (!user) return Response.badRequest(res, { message: 'This reset link is invalid or has expired. Ask for a new one.' });

    // changing the password also signs out every device
    await prisma.user.update({ where: { id: user.id }, data: { password: await AuthHelper.generateHash(password), passwordResetHash: null, passwordResetExpires: null, refreshToken: null } });
    return Response.success(res, { message: 'Password changed. You can sign in now.' });
  } catch (error) {
    Logger.error(error.message + ' at resetPassword function auth controller');
    next(error);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!validPassword(newPassword)) return Response.badRequest(res, { message: 'Choose a new password of 8 to 72 characters.' });
    const user = await prisma.user.findUnique({ where: { id: parseInt(req.query.auth_user_id) } });
    if (!user) return Response.badRequest(res, { message: 'user not found' });
    try {
      await AuthHelper.compareHash(String(currentPassword || ''), user.password);
    } catch (e) {
      return Response.badRequest(res, { message: 'Your current password is not correct.' });
    }
    await prisma.user.update({ where: { id: user.id }, data: { password: await AuthHelper.generateHash(newPassword) } });
    return Response.success(res, { message: 'Password changed.' });
  } catch (error) {
    Logger.error(error.message + ' at changePassword function auth controller');
    next(error);
  }
};

module.exports = { login, logout, generateTokens, getUser, forgotPassword, resetPassword, changePassword };
