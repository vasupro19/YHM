const authRoute = require('./auth.routes');
const UserRoute = require('./user.routes');
const ClientRoute = require('./client.routes');
const MenuRoute = require('./menu.routes');
const RoleRoute = require('./role.routes');
const DepartmentRoute = require('./department.routes');
const CategoryRoute = require('./category.routes');
const TaskRoute = require('./task.routes');
const FileOperationRoute = require('./fileOperation.routes');
const app = require('../app');

//! always remove  before pushing to server
function appRouter() {
  app.use('/v1/auth', authRoute);
  app.use('/v1/user', UserRoute);
  app.use('/v1/client', ClientRoute);
  app.use('/v1/menu', MenuRoute);
  app.use('/v1/role', RoleRoute);
  app.use('/v1/department', DepartmentRoute);
  app.use('/v1/category', CategoryRoute);
  app.use('/v1/task', TaskRoute);
  app.use('/v1/fileOperation', FileOperationRoute);

  //\\ ==============================|| END: UI MASTERS ROUTES ||============================== //\\
}

module.exports = appRouter;
