// removes secrets before a user record is sent to the browser
const publicUser = (user) => {
  if (!user) return user;
  const { password, refreshToken, apiToken, ...rest } = user;
  return rest;
};

module.exports = { publicUser };
