const generateUniqueId = (length = 6, prefix = "") => {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < length; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}${id}`;
};

module.exports = {
  generateUniqueId,
};
