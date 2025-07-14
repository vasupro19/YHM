const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function validateQueryInputs(tableName = '', data = {}, where = {}) {
  if (!tableName || typeof tableName !== 'string') {
    throw new Error('Table name must be a string');
  }

  if (data !== undefined && (typeof data !== 'object' || Array.isArray(data) || data === null)) {
    throw new Error('Data must be a valid object');
  }

  if (where !== undefined && (typeof where !== 'object' || Array.isArray(where) || where === null)) {
    throw new Error('Where clause must be a valid object');
  }
}

async function isUnique(model, data) {
  const exists = await model.findFirst({ where: data });
  if (exists) {
    throw new Error('Data already exists!');
  }
  return true;
}

async function getCount(model, query = {}) {
  return await model.count({ where: query });
}

async function create(model, data) {
  return await model.create({ data });
}

async function readWithPagination(model, query, pagination = {}, exclude = [], orderBy = []) {
  return await model.findMany({
    where: query,
    select: exclude.length ? Object.fromEntries(exclude.map((key) => [key, false])) : undefined,
    skip: pagination.skip || 0,
    take: pagination.limit || 10,
    orderBy
  });
}

async function read(model, query, exclude = [], orderBy = []) {
  return await model.findFirst({
    where: query,
    select: exclude.length ? Object.fromEntries(exclude.map((key) => [key, false])) : undefined,
    orderBy
  });
}

async function update(model, query, data) {
  return await model.updateMany({ where: query, data });
}

async function remove(model, query) {
  return await model.deleteMany({ where: query });
}

async function findDetails(model, query, includes = []) {
  return await model.findMany({
    where: query,
    include: includes.length ? Object.fromEntries(includes.map((key) => [key, true])) : undefined
  });
}

async function findDetailsWithSelectedField(model, query, projection = [], includes = []) {
  return await model.findMany({
    where: query.conditions || {},
    select: projection.length ? Object.fromEntries(projection.map((key) => [key, true])) : undefined,
    include: includes.length ? Object.fromEntries(includes.map((key) => [key, true])) : undefined
  });
}

// helper function for where raw with join query
function buildCustomJoinQuery({ mainTable, alias = 'main', selectFields = [], joins = [], where = {} }) {
  if (!mainTable || typeof mainTable !== 'string') {
    throw new Error('Main table must be a valid string');
  }

  if (!Array.isArray(selectFields) || selectFields.length === 0) {
    throw new Error('You must provide at least one select field');
  }

  const whereClauses = [];
  const values = [];

  let sql = `SELECT ${selectFields.join(', ')} FROM \`${mainTable}\` AS ${alias}`;

  joins.forEach(({ table, tableAlias, on, type = 'INNER' }) => {
    if (!table || !tableAlias || !on) {
      throw new Error('Join must include table, tableAlias, and on condition');
    }
    sql += ` ${type.toUpperCase()} \`${table}\` ${tableAlias} ON ${on}`;
  });

  Object.entries(where).forEach(([key, value]) => {
    if (value === 'null') {
      whereClauses.push(`${key} IS NULL`);
    } else if (value === 'not_null') {
      whereClauses.push(`${key} IS NOT NULL`);
    } else {
      whereClauses.push(`${key} = ?`);
      values.push(value);
    }
  });

  if (whereClauses.length > 0) {
    sql += ` WHERE ${whereClauses.join(' AND ')}`;
  }

  return { sql, values };
}

// helper function for raw query
function buildWhereClause(tableName, query = {}) {
  validateQueryInputs(tableName, {}, {});

  const whereClauses = [];
  const values = [];

  Object.entries(query).forEach(([key, value]) => {
    if (value === 'null') {
      whereClauses.push(`\`${key}\` IS NULL`);
    } else if (value === 'not_null') {
      whereClauses.push(`\`${key}\` IS NOT NULL`);
    } else {
      whereClauses.push(`\`${key}\` = ?`);
      values.push(value);
    }
  });

  const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const sql = `SELECT * FROM \`${tableName}\` ${whereClause}`;

  return { sql, values };
}

// function for make insert query
function queryOfInsertRecord(tableName, data) {
  validateQueryInputs(tableName, data, {});

  const columns = Object.keys(data);
  const placeholders = columns.map(() => '?').join(', ');
  const values = Object.values(data);

  const sql = `INSERT INTO \`${tableName}\` (${columns.join(', ')}) VALUES (${placeholders})`;

  return { sql, values };
}

// function for make bulk insert query
function queryOfBulkInsert(tableName, dataArray = []) {
  if (!Array.isArray(dataArray) || dataArray.length === 0) {
    throw new Error('Data array must be a non-empty array of objects.');
  }

  const columns = Object.keys(dataArray[0]);
  const placeholders = dataArray.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
  const values = dataArray.flatMap((row) => columns.map((col) => row[col]));

  const sql = `INSERT INTO \`${tableName}\` (${columns.join(', ')}) VALUES ${placeholders}`;

  return { sql, values };
}

// function for check unique query
function isUniqueForRawQuery(tableName, where) {
  validateQueryInputs(tableName, {}, where);

  const keys = Object.keys(where);
  const values = Object.values(where);

  if (keys.length === 0) return false;

  const whereClause = keys.map((key) => `${key} = ?`).join(' AND ');
  const sql = `SELECT 1 FROM \`${tableName}\` WHERE ${whereClause} LIMIT 1`;

  return { sql, values };
}

// function for make update query
function queryOfUpdateRecord(tableName, data, where) {
  validateQueryInputs(tableName, data, where);

  const setCols = Object.keys(data).map((col) => `\`${col}\` = ?`);
  const whereCols = Object.keys(where).map((col) => `\`${col}\` = ?`);

  const values = [...Object.values(data), ...Object.values(where)];

  const sql = `UPDATE \`${tableName}\` SET ${setCols.join(', ')} WHERE ${whereCols.join(' AND ')}`;

  return { sql, values };
}

module.exports = {
  isUnique,
  getCount,
  readWithPagination,
  read,
  create,
  update,
  remove,
  findDetails,
  findDetailsWithSelectedField,
  buildWhereClause,
  queryOfInsertRecord,
  queryOfUpdateRecord,
  isUniqueForRawQuery,
  buildCustomJoinQuery,
  queryOfBulkInsert
};
