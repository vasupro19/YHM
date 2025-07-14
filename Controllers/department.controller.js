const Response = require('../Helpers/response.helper');
const crudHelper = require('../Helpers/crud.helper');
const Logger = require('../Helpers/logger');
const controllerName = 'department.controller';

// create the department
const createDepartment = async (req, res) => {
  const clientDb = req.dbConnection;

  try {
    const isUniqueQuery = crudHelper.isUniqueForRawQuery('Department', {
      name: req.body.name
    });

    const [rows] = await clientDb.query(isUniqueQuery.sql, isUniqueQuery.values);

    if (rows.length !== 0) {
      return Response.badRequest(res, {
        message: 'Department already exists'
      });
    }

    const data = {
      ...req.body,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const createQuery = crudHelper.queryOfInsertRecord('Department', data);

    await clientDb.query(createQuery.sql, createQuery.values);

    return Response.success(res, {
      data: {},
      message: 'Department Created SuccessFully'
    });
  } catch (error) {
    Logger.error(error.message + ' at createDepartment function ' + controllerName);
    return Response.error(res, {
      data: [],
      message: error.message
    });
  } finally {
    await clientDb.end();
  }
};

// get department by different query parameters
const getDepartment = async (req, res) => {
  const clientDb = req.dbConnection;
  try {
    const sanitizedQuery = req.sanitizedQuery;

    const whereQuery = crudHelper.buildWhereClause('Department', sanitizedQuery);

    const [departments] = await clientDb.query(whereQuery.sql, whereQuery.values);

    return Response.success(res, {
      data: departments,
      message: 'Department Found'
    });
  } catch (error) {
    Logger.error(error.message + ' at getDepartment function ' + controllerName);
    return Response.error(res, {
      data: [],
      message: error.message
    });
  } finally {
    await clientDb.end();
  }
};

// update the department
const updateDepartment = async (req, res) => {
  const clientDb = req.dbConnection;

  try {
    const { id } = req.params;

    if (!id) {
      return Response.error(res, {
        message: 'Department Id is required'
      });
    }

    const updatePayload = {
      ...req.body,
      updatedAt: new Date()
    };

    const { sql, values } = crudHelper.queryOfUpdateRecord('Department', updatePayload, { id: Number(id) });

    await clientDb.query(sql, values);

    return Response.success(res, {
      data: {},
      message: 'Department updated successfully'
    });
  } catch (error) {
    Logger.error(error.message + ' at updateDepartment function ' + controllerName);
    return Response.error(res, {
      data: {},
      message: error.message
    });
  } finally {
    await clientDb.end();
  }
};

module.exports = {
  createDepartment,
  getDepartment,
  updateDepartment
};
