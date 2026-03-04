const express = require('express');
const { asyncHandler } = require('../endpointHelper.js');
const { DB, Role } = require('../database/database.js');
const { authRouter, setAuth } = require('./authRouter.js');

const userRouter = express.Router();

userRouter.docs = [
  {
    method: 'GET',
    path: '/api/user/me',
    requiresAuth: true,
    description: 'Get authenticated user',
    example: `curl -X GET localhost:3000/api/user/me -H 'Authorization: Bearer tttttt'`,
    response: {
      id: 1,
      name: '常用名字',
      email: 'a@jwt.com',
      roles: [{ role: 'admin' }],
    },
  },
  {
    method: 'PUT',
    path: '/api/user/:userId',
    requiresAuth: true,
    description: 'Update user',
    example: `curl -X PUT localhost:3000/api/user/1 -d '{"name":"常用名字", "email":"a@jwt.com", "password":"admin"}' -H 'Content-Type: application/json' -H 'Authorization: Bearer tttttt'`,
    response: {
      user: {
        id: 1,
        name: '常用名字',
        email: 'a@jwt.com',
        roles: [{ role: 'admin' }],
      },
      token: 'tttttt',
    },
  },
];

// getUser
userRouter.get(
  '/me',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    res.json(req.user);
  })
);

// updateUser
userRouter.put(
  '/:userId',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body;
    const userId = Number(req.params.userId);
    const user = req.user;
    if (user.id !== userId && !user.isRole(Role.Admin)) {
      return res.status(403).json({ message: 'unauthorized' });
    }

    const updatedUser = await DB.updateUser(userId, name, email, password);
    const auth = await setAuth(updatedUser);
    res.json({ user: updatedUser, token: auth });
  })
);

// listUsers
userRouter.get(
  '/',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user.isRole(Role.Admin)) {
      return res.status(403).json({ message: 'unauthorized' });
    }

    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);
    const name = req.query.name ?? '*';

    const usersPlus = await DB.getUsers(page, limit, name);

    const more = usersPlus.length > limit;
    const users = more ? usersPlus.slice(0, limit) : usersPlus;

    res.json({ users, more });
  })
);

// deleteUser
userRouter.delete(
  '/:userId',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.userId);

    // non-admin cannot delete other users
    if (!req.user.isRole(Role.Admin) && req.user.id !== userId) {
      return res.status(403).json({ message: 'unauthorized' });
    }

    await DB.deleteUser(userId);

    res.status(200).json({ message: 'deleted' });
  })
);
module.exports = userRouter;
