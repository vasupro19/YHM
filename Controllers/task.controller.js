const Response = require('../Helpers/response.helper');
const crudHelper = require('../Helpers/crud.helper');
const Logger = require('../Helpers/logger');
const controllerName = 'task.controller';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// create the department
const createTask = async (req, res) => {
  const clientDb = req.dbConnection;

  try {
    const data = {
      ...req.body,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const attachments = data.attachments;

    delete data.attachments;

    const createQuery = crudHelper.queryOfInsertRecord('Task', data);

    const [insertResult] = await clientDb.query(createQuery.sql, createQuery.values);

    const [task] = await clientDb.query(`SELECT id, taskTitle, status, closeDate FROM Task WHERE id = ?`, [insertResult.insertId]);

    const attachmentData = [];

    if (attachments?.length) {
      for (let i = 0; i < attachments.length; i++) {
        attachmentData.push({
          taskId: task[0].id,
          path: attachments?.[i]?.link
        });
      }
    }

    if (attachmentData?.length) {
      const attachmentQuery = crudHelper.queryOfBulkInsert('Attachment', attachmentData);
      await clientDb.query(attachmentQuery.sql, attachmentQuery.values);
    }

    if (task.length) {
      const dataToUpdate = {
        taskNumber: 'WC-' + task[0].id,
        updatedAt: new Date()
      };

      const updateQuery = crudHelper.queryOfUpdateRecord('Task', dataToUpdate, { id: task[0].id });
      await clientDb.query(updateQuery.sql, updateQuery.values);
    }

    return Response.success(res, {
      data: {},
      message: 'Task Created SuccessFully'
    });
  } catch (error) {
    Logger.error(error.message + ' at createTask function ' + controllerName);
    return Response.error(res, {
      data: [],
      message: error.message
    });
  } finally {
    await clientDb.end();
  }
};

// get department by different query parameters
const getTask = async (req, res) => {
  const clientDb = req.dbConnection;
  try {
    const sanitizedQuery = req.sanitizedQuery;

    const rows = crudHelper.buildCustomJoinQuery({
      mainTable: 'Task',
      alias: 't',
      selectFields: [
        't.id AS id',
        't.taskTitle AS taskTitle',
        't.closeDate AS closeDate',
        't.taskBody AS taskBody',
        'd.id AS departmentId',
        'd.name AS department_name',
        'c.id AS categoryId',
        'c.name AS category_name',
        't.raisedTo AS raisedTo',
        't.status AS status'
      ],
      joins: [
        {
          table: 'Department',
          tableAlias: 'd',
          on: 'd.id = t.departmentId',
          type: 'JOIN'
        },
        {
          table: 'Category',
          tableAlias: 'c',
          on: 'c.id = t.categoryId',
          type: 'JOIN'
        }
      ],
      sanitizedQuery
    });

    const [tasks] = await clientDb.query(rows.sql, rows.values);

    const response = [];

    for (let task of tasks) {
      const user = await crudHelper.read(prisma.user, { id: task.raisedTo });
      const [attachments] = await clientDb.query(`SELECT path FROM Attachment WHERE taskId = ?`, [task.id]);
      task.attachments = attachments.map((a) => a.path);
      task.raisedTo_name = user.name;
      task.closeDate = new Date(task.closeDate).toDateString();
      response.push(task);
    }

    return Response.success(res, {
      data: response,
      message: 'Department Found'
    });
  } catch (error) {
    Logger.error(error.message + ' at getTask function ' + controllerName);
    return Response.error(res, {
      data: [],
      message: error.message
    });
  } finally {
    await clientDb.end();
  }
};

// update the department
const updateTask = async (req, res) => {
  const clientDb = req.dbConnection;

  try {
    const { id } = req.params;

    if (!id) {
      return Response.error(res, {
        message: 'Task Id is required'
      });
    }

    const updatePayload = {
      ...req.body,
      closeDate: new Date(req.body.closeDate),
      updatedAt: new Date()
    };

    const attachments = updatePayload.attachments;

    delete updatePayload.attachments;

    const attachmentData = [];

    if (attachments?.length) {
      for (let i = 0; i < attachments.length; i++) {
        attachmentData.push({
          taskId: Number(id),
          path: attachments?.[i]?.link
        });
      }
    }

    if (attachmentData?.length) {
      await clientDb.query(`DELETE FROM Attachment WHERE taskId = ?`, [Number(id)]);

      const attachmentQuery = crudHelper.queryOfBulkInsert('Attachment', attachmentData);

      await clientDb.query(attachmentQuery.sql, attachmentQuery.values);
    }

    const { sql, values } = crudHelper.queryOfUpdateRecord('Task', updatePayload, { id: Number(id) });

    await clientDb.query(sql, values);

    return Response.success(res, {
      data: {},
      message: 'Task updated successfully'
    });
  } catch (error) {
    Logger.error(error.message + ' at updateTask function ' + controllerName);
    return Response.error(res, {
      data: {},
      message: error.message
    });
  } finally {
    await clientDb.end();
  }
};

module.exports = {
  createTask,
  getTask,
  updateTask
};
