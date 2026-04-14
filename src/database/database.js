const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const logger = require('../logger.js');

const config = (() => {
  try {
    return require('../config.js');
  } catch (_e) {
    return require('../config.template.js');
  }
})();

const { StatusCodeError } = require('../endpointHelper.js');
const { Role } = require('../model/model.js');
const dbModel = require('./dbModel.js');

class DB {
  constructor() {
    this.initialized =
      process.env.NODE_ENV === 'test'
        ? Promise.resolve()
        : this.initializeDatabase();
  }

  async getMenu() {
    const connection = await this.getConnection();
    try {
      const rows = await this.query(connection, `SELECT * FROM menu`);
      return rows;
    } finally {
      connection.end();
    }
  }

  async addMenuItem(item) {
    const connection = await this.getConnection();
    try {
      const addResult = await this.query(
        connection,
        `INSERT INTO menu (title, description, image, price) VALUES (?, ?, ?, ?)`,
        [item.title, item.description, item.image, item.price]
      );
      return { ...item, id: addResult.insertId };
    } finally {
      connection.end();
    }
  }
  async addUser(user) {
    const connection = await this.getConnection();
    try {
      const hashedPassword = await bcrypt.hash(user.password, 10);

      const userResult = await this.query(
        connection,
        `INSERT INTO user (name, email, password) VALUES (?, ?, ?)`,
        [user.name, user.email, hashedPassword]
      );
      const userId = userResult.insertId;

      for (const role of user.roles) {
        switch (role.role) {
          case Role.Franchisee: {
            const franchiseId = await this.getID(
              connection,
              'name',
              role.object,
              'franchise'
            );
            await this.query(
              connection,
              `INSERT INTO userRole (userId, role, objectId) VALUES (?, ?, ?)`,
              [userId, role.role, franchiseId]
            );
            break;
          }
          default: {
            await this.query(
              connection,
              `INSERT INTO userRole (userId, role, objectId) VALUES (?, ?, ?)`,
              [userId, role.role, 0]
            );
            break;
          }
        }
      }

      return { ...user, id: userId, password: undefined };
    } finally {
      connection.end();
    }
  }

  async getUser(email, password) {
    const connection = await this.getConnection();
    try {
      const userResult = await this.query(
        connection,
        `SELECT * FROM user WHERE email=?`,
        [email]
      );
      const user = userResult[0];

      if (
        !user ||
        (password && !(await bcrypt.compare(password, user.password)))
      ) {
        throw new StatusCodeError('unknown user', 404);
      }

      const roleResult = await this.query(
        connection,
        `SELECT * FROM userRole WHERE userId=?`,
        [user.id]
      );
      const roles = roleResult.map((r) => {
        return { objectId: r.objectId || undefined, role: r.role };
      });

      return { ...user, roles, password: undefined };
    } finally {
      connection.end();
    }
  }
  async promoteUserToAdmin(email) {
    const connection = await this.getConnection();
    try {
      const users = await this.query(
        connection,
        `SELECT id, email FROM user WHERE email=?`,
        [email]
      );

      if (users.length === 0) {
        throw new StatusCodeError('target user not found', 404);
      }

      const userId = users[0].id;

      const existingRole = await this.query(
        connection,
        `SELECT * FROM userRole WHERE userId=? AND role=? AND objectId=?`,
        [userId, Role.Admin, 0]
      );

      if (existingRole.length === 0) {
        await this.query(
          connection,
          `INSERT INTO userRole (userId, role, objectId) VALUES (?, ?, ?)`,
          [userId, Role.Admin, 0]
        );
      }

      return { userId, email };
    } finally {
      connection.end();
    }
  }

  async updateUser(userId, name, email, password) {
    const connection = await this.getConnection();
    try {
      const params = [];

      if (password) {
        const hashedPassword = await bcrypt.hash(password, 10);
        params.push(`password='${hashedPassword}'`);
      }
      if (email) {
        params.push(`email='${email}'`);
      }
      if (name) {
        params.push(`name='${name}'`);
      }

      if (params.length > 0) {
        const query = `UPDATE user SET ${params.join(', ')} WHERE id=${userId}`;
        await this.query(connection, query);
      }

      return this.getUser(email, password);
    } finally {
      connection.end();
    }
  }

  async getUsers(page = 1, limit = 10, name = '*') {
    const connection = await this.getConnection();
    try {
      const safePage = Number(page) > 0 ? Number(page) : 1;
      const safeLimit = Number(limit) > 0 ? Number(limit) : 10;
      const offset = (safePage - 1) * safeLimit;

      let whereClause = '';
      if (name && name !== '*') {
        const safeName = name.replace(/'/g, "''");
        whereClause = `WHERE name LIKE '%${safeName}%'`;
      }

      const users = await this.query(
        connection,
        `SELECT id, name, email
         FROM user
         ${whereClause}
         ORDER BY id
         LIMIT ${safeLimit + 1} OFFSET ${offset}`
      );

      return users;
    } finally {
      connection.end();
    }
  }

  async loginUser(userId, token) {
    token = this.getTokenSignature(token);
    const connection = await this.getConnection();
    try {
      await this.query(
        connection,
        `INSERT INTO auth (token, userId) VALUES (?, ?) ON DUPLICATE KEY UPDATE token=token`,
        [token, userId]
      );
    } finally {
      connection.end();
    }
  }

  async isLoggedIn(token) {
    token = this.getTokenSignature(token);
    const connection = await this.getConnection();
    try {
      const authResult = await this.query(
        connection,
        `SELECT userId FROM auth WHERE token=?`,
        [token]
      );
      return authResult.length > 0;
    } finally {
      connection.end();
    }
  }

  async logoutUser(token) {
    token = this.getTokenSignature(token);
    const connection = await this.getConnection();
    try {
      await this.query(connection, `DELETE FROM auth WHERE token=?`, [token]);
    } finally {
      connection.end();
    }
  }

  async getOrders(user, page = 1) {
    const connection = await this.getConnection();
    try {
      const offset = this.getOffset(page, config.db.listPerPage);
      const orders = await this.query(
        connection,
        `SELECT id, franchiseId, storeId, date FROM dinerOrder WHERE dinerId=? LIMIT ${offset},${config.db.listPerPage}`,
        [user.id]
      );

      for (const order of orders) {
        const items = await this.query(
          connection,
          `SELECT id, menuId, description, price FROM orderItem WHERE orderId=?`,
          [order.id]
        );
        order.items = items;
      }

      return { dinerId: user.id, orders, page };
    } finally {
      connection.end();
    }
  }

  async addDinerOrder(user, order) {
    const connection = await this.getConnection();
    try {
      const orderResult = await this.query(
        connection,
        `INSERT INTO dinerOrder (dinerId, franchiseId, storeId, date) VALUES (?, ?, ?, now())`,
        [user.id, order.franchiseId, order.storeId]
      );
      const orderId = orderResult.insertId;

      for (const item of order.items) {
        const menuId = await this.getID(connection, 'id', item.menuId, 'menu');
        await this.query(
          connection,
          `INSERT INTO orderItem (orderId, menuId, description, price) VALUES (?, ?, ?, ?)`,
          [orderId, menuId, item.description, item.price]
        );
      }

      return { ...order, id: orderId };
    } finally {
      connection.end();
    }
  }

  async createFranchise(franchise) {
    const connection = await this.getConnection();
    try {
      for (const admin of franchise.admins) {
        const adminUser = await this.query(
          connection,
          `SELECT id, name FROM user WHERE email=?`,
          [admin.email]
        );
        if (adminUser.length === 0) {
          throw new StatusCodeError(
            `unknown user for franchise admin ${admin.email} provided`,
            404
          );
        }
        admin.id = adminUser[0].id;
        admin.name = adminUser[0].name;
      }

      const franchiseResult = await this.query(
        connection,
        `INSERT INTO franchise (name) VALUES (?)`,
        [franchise.name]
      );
      franchise.id = franchiseResult.insertId;

      for (const admin of franchise.admins) {
        await this.query(
          connection,
          `INSERT INTO userRole (userId, role, objectId) VALUES (?, ?, ?)`,
          [admin.id, Role.Franchisee, franchise.id]
        );
      }

      return franchise;
    } finally {
      connection.end();
    }
  }

  async deleteFranchise(franchiseId) {
    const connection = await this.getConnection();
    try {
      await connection.beginTransaction();
      try {
        await this.query(connection, `DELETE FROM store WHERE franchiseId=?`, [
          franchiseId,
        ]);
        await this.query(connection, `DELETE FROM userRole WHERE objectId=?`, [
          franchiseId,
        ]);
        await this.query(connection, `DELETE FROM franchise WHERE id=?`, [
          franchiseId,
        ]);
        await connection.commit();
      } catch {
        await connection.rollback();
        throw new StatusCodeError('unable to delete franchise', 500);
      }
    } finally {
      connection.end();
    }
  }

  async getFranchises(authUser, page = 0, limit = 10, nameFilter = '*') {
    const connection = await this.getConnection();

    const offset = page * limit;
    nameFilter = nameFilter.replace(/\*/g, '%');

    try {
      let franchises = await this.query(
        connection,
        `SELECT id, name FROM franchise WHERE name LIKE ? LIMIT ${limit + 1} OFFSET ${offset}`,
        [nameFilter]
      );

      const more = franchises.length > limit;
      if (more) {
        franchises = franchises.slice(0, limit);
      }

      for (const franchise of franchises) {
        if (authUser?.isRole(Role.Admin)) {
          await this.getFranchise(franchise);
        } else {
          franchise.stores = await this.query(
            connection,
            `SELECT id, name FROM store WHERE franchiseId=?`,
            [franchise.id]
          );
        }
      }

      return [franchises, more];
    } finally {
      connection.end();
    }
  }

  async getUserFranchises(userId) {
    const connection = await this.getConnection();
    try {
      let franchiseIds = await this.query(
        connection,
        `SELECT objectId FROM userRole WHERE role='franchisee' AND userId=?`,
        [userId]
      );

      if (franchiseIds.length === 0) {
        return [];
      }

      franchiseIds = franchiseIds.map((v) => v.objectId);

      const franchises = await this.query(
        connection,
        `SELECT id, name FROM franchise WHERE id in (${franchiseIds.join(',')})`
      );

      for (const franchise of franchises) {
        await this.getFranchise(franchise);
      }

      return franchises;
    } finally {
      connection.end();
    }
  }

  async getFranchise(franchise) {
    const connection = await this.getConnection();
    try {
      franchise.admins = await this.query(
        connection,
        `SELECT u.id, u.name, u.email FROM userRole AS ur JOIN user AS u ON u.id=ur.userId WHERE ur.objectId=? AND ur.role='franchisee'`,
        [franchise.id]
      );

      franchise.stores = await this.query(
        connection,
        `SELECT s.id, s.name, COALESCE(SUM(oi.price), 0) AS totalRevenue FROM dinerOrder AS do JOIN orderItem AS oi ON do.id=oi.orderId RIGHT JOIN store AS s ON s.id=do.storeId WHERE s.franchiseId=? GROUP BY s.id`,
        [franchise.id]
      );

      return franchise;
    } finally {
      connection.end();
    }
  }

  async createStore(franchiseId, store) {
    const connection = await this.getConnection();
    try {
      const insertResult = await this.query(
        connection,
        `INSERT INTO store (franchiseId, name) VALUES (?, ?)`,
        [franchiseId, store.name]
      );
      return { id: insertResult.insertId, franchiseId, name: store.name };
    } finally {
      connection.end();
    }
  }

  async deleteStore(franchiseId, storeId) {
    const connection = await this.getConnection();
    try {
      await this.query(
        connection,
        `DELETE FROM store WHERE franchiseId=? AND id=?`,
        [franchiseId, storeId]
      );
    } finally {
      connection.end();
    }
  }

  async deleteUser(userId) {
    const connection = await this.getConnection();
    try {
      const result = await this.query(
        connection,
        'DELETE FROM user WHERE id = ?',
        [userId]
      );
      return result.affectedRows > 0;
    } finally {
      connection.end();
    }
  }

  getOffset(currentPage = 1, listPerPage) {
    return (currentPage - 1) * [listPerPage];
  }

  getTokenSignature(token) {
    const parts = token.split('.');
    if (parts.length > 2) {
      return parts[2];
    }
    return '';
  }

  async query(connection, sql, params = []) {
    const start = Date.now();
    const [results] = await connection.execute(sql, params);
    const durationMs = Date.now() - start;
    await logger.logDb(sql, params, durationMs);
    return results;
  }

  async getID(connection, key, value, table) {
    const rows = await this.query(
      connection,
      `SELECT id FROM ${table} WHERE ${key}=?`,
      [value]
    );
    if (rows.length > 0) {
      return rows[0].id;
    }
    throw new Error('No ID found');
  }

  async getConnection() {
    await this.initialized;
    return this._getConnection();
  }

  async _getConnection(setUse = true) {
    const connection = await mysql.createConnection({
      host: config.db.connection.host,
      user: config.db.connection.user,
      password: config.db.connection.password,
      connectTimeout: config.db.connection.connectTimeout,
      decimalNumbers: true,
      charset: 'UTF8MB4_GENERAL_CI',
    });
    if (setUse) {
      await connection.query(`USE ${config.db.connection.database}`);
    }
    return connection;
  }

  async initializeDatabase() {
    try {
      const connection = await this._getConnection(false);
      try {
        const dbExists = await this.checkDatabaseExists(connection);
        console.log(
          dbExists ? 'Database exists' : 'Database does not exist, creating it'
        );

        await connection.query(
          `CREATE DATABASE IF NOT EXISTS ${config.db.connection.database}`
        );
        await connection.query(`USE ${config.db.connection.database}`);

        if (!dbExists) {
          console.log('Successfully created database');
        }

        for (const statement of dbModel.tableCreateStatements) {
          await connection.query(statement);
        }

        if (!dbExists) {
          const defaultAdmin = {
            name: '常用名字',
            email: 'a@jwt.com',
            password: 'admin',
            roles: [{ role: Role.Admin }],
          };
          await this.addUser(defaultAdmin);
        }
      } finally {
        connection.end();
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          message: 'Error initializing database',
          exception: err.message,
          connection: config.db.connection,
        })
      );
    }
  }

  async checkDatabaseExists(connection) {
    const [rows] = await connection.execute(
      `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?`,
      [config.db.connection.database]
    );
    return rows.length > 0;
  }
}

const db = new DB();
module.exports = { Role, DB: db };
