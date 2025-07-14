const Response = require('../Helpers/response.helper');
const crudHelper = require('../Helpers/crud.helper');
const Logger = require('../Helpers/logger');
const controllerName = 'category.controller';

// create the department
const createCategory = async (req, res) => {
  const clientDb = req.dbConnection;

  try {
    const isUniqueQuery = crudHelper.isUniqueForRawQuery('Category', {
      name: req.body.name
    });

    const [rows] = await clientDb.query(isUniqueQuery.sql, isUniqueQuery.values);

    if (rows.length !== 0) {
      return Response.badRequest(res, {
        message: 'Category already exists'
      });
    }

    const data = {
      ...req.body,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const createQuery = crudHelper.queryOfInsertRecord('Category', data);

    await clientDb.query(createQuery.sql, createQuery.values);

    return Response.success(res, {
      data: {},
      message: 'Category Created SuccessFully'
    });
  } catch (error) {
    Logger.error(error.message + ' at createCategory function ' + controllerName);
    return Response.error(res, {
      data: [],
      message: error.message
    });
  } finally {
    await clientDb.end();
  }
};

// get department by different query parameters
const getCategory = async (req, res) => {
  const clientDb = req.dbConnection;
  try {
    const { auth_user_id, user_role, ...query } = req.query;

    const rows = crudHelper.buildCustomJoinQuery({
      mainTable: 'Category',
      alias: 'c',
      selectFields: ['c.id AS id', 'c.name AS name', 'd.id AS departmentId', 'd.name AS department_name'],
      joins: [
        {
          table: 'Department',
          tableAlias: 'd',
          on: 'd.id = c.departmentId',
          type: 'JOIN'
        }
      ],
      query
    });

    const [categories] = await clientDb.query(rows.sql, rows.values);

    return Response.success(res, {
      data: categories,
      message: 'Department Found'
    });
  } catch (error) {
    Logger.error(error.message + ' at getCategory function ' + controllerName);
    return Response.error(res, {
      data: [],
      message: error.message
    });
  } finally {
    await clientDb.end();
  }
};

// update the department
const updateCategory = async (req, res) => {
  const clientDb = req.dbConnection;

  try {
    const { id } = req.params;

    if (!id) {
      return Response.error(res, {
        message: 'Category Id is required'
      });
    }

    const updatePayload = {
      ...req.body,
      updatedAt: new Date()
    };

    const { sql, values } = crudHelper.queryOfUpdateRecord('Category', updatePayload, { id: Number(id) });

    await clientDb.query(sql, values);

    return Response.success(res, {
      data: {},
      message: 'Category updated successfully'
    });
  } catch (error) {
    Logger.error(error.message + ' at updateCategory function ' + controllerName);
    return Response.error(res, {
      data: {},
      message: error.message
    });
  } finally {
    await clientDb.end();
  }
};

module.exports = {
  createCategory,
  getCategory,
  updateCategory
};
