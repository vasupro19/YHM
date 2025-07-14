const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const isBetween = require("dayjs/plugin/isBetween");

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);

const IST = (format = false, duration = false, unit = false) => {
  if (format === "date" && duration && unit) {
    const date = dayjs().tz("Asia/Kolkata").add(duration, unit).toDate();
    return date;
  }
  if (format === "time") {
    const time = dayjs().tz("Asia/Kolkata").format("HH:mm:ss");
    return time;
  }
  if (format === "date") {
    const date = dayjs().tz("Asia/Kolkata").format("YYYY-MM-DD");
    return date;
  }
  if (format === "database") {
    const date = dayjs().add(5, "h").add(30, "m");
    return date;
  }
  const dateTime = dayjs().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
  return dateTime;
};

const formatDateToString = (dateObj, format = "YYYY-MM-DD") => {
  const date = dayjs(dateObj).tz("Asia/Kolkata").format(format);
  return date;
};

const removeDaysFromDate = (originDate, removeFactor, format = "YYYY-MM-DD") =>
  dayjs(originDate).subtract(removeFactor, "day").format(format);

const addDaysToDate = (originDate, addFactor, format = "YYYY-MM-DD") => {
  const date = dayjs(originDate).add(addFactor, "day").format(format);
  return date;
};

const humanReadable = (date) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  })
    .format(new Date(date) - new Date(18000000 + 1800000))
    .toString()
    .replace(/([,]\s[1][2][:][0][0])\s\w+/g, "");

const checkInRange = (from, to, check) =>
  dayjs(check).isBetween(from, dayjs(to));

module.exports = {
  IST,
  formatDateToString,
  addDaysToDate,
  removeDaysFromDate,
  humanReadable,
  checkInRange,
};
