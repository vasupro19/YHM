function sanitizeObject(obj = {}) {
  return Object.fromEntries(
    Object.entries(obj).filter(([key, value]) => {
      return (
        key.trim() !== "" &&
        value !== null &&
        value !== undefined &&
        value !== ""
      );
    })
  );
}

module.exports = {
  sanitizeObject,
};
