const request = require('supertest');
const app = require('../service');
const { Role, DB } = require('../database/database');

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

async function registerUser(password = 'a') {
  const user = { name: randomName(), email: `${randomName()}@test.com`, password };
  const res = await request(app).post('/api/auth').send(user);
  expect(res.status).toBe(200);
  return { ...user, id: res.body.user.id, token: res.body.token };
}

async function login(email, password) {
  const res = await request(app).put('/api/auth').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.token;
}

async function createAdmin() {
  const password = 'toomanysecrets';
  let user = { password, roles: [{ role: Role.Admin }] };
  user.name = randomName();
  user.email = `${user.name}@admin.com`;
  await DB.addUser(user);
  const token = await login(user.email, password);
  return { email: user.email, token };
}

let admin;
let diner;
let menuId;
let franchiseId;
let storeId;

beforeAll(async () => {
  admin = await createAdmin();
  diner = await registerUser('dinerpw');

  // Add menu item
  const menuRes = await request(app)
    .put('/api/order/menu')
    .set('Authorization', `Bearer ${admin.token}`)
    .send({
      title: `pizza-${randomName()}`,
      description: 'desc',
      image: 'pizza.png',
      price: 0.01,
    });

  expect(menuRes.status).toBe(200);
  menuId = menuRes.body[menuRes.body.length - 1].id;

  // Create franchise + store
  const frRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ name: `fr-${randomName()}`, admins: [{ email: diner.email }] });

  franchiseId = frRes.body.id;

  const storeRes = await request(app)
    .post(`/api/franchise/${franchiseId}/store`)
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ franchiseId, name: `store-${randomName()}` });

  storeId = storeRes.body.id;
});

test('GET /api/order/menu returns menu', async () => {
  const res = await request(app).get('/api/order/menu');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('non-admin cannot add menu item', async () => {
  const res = await request(app)
    .put('/api/order/menu')
    .set('Authorization', `Bearer ${diner.token}`)
    .send({
      title: 'bad',
      description: 'bad',
      image: 'bad.png',
      price: 0.1,
    });

  expect(res.status).toBe(403);
});

test('POST /api/order creates order (mock factory)', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ jwt: 'mock.jwt.token', reportUrl: 'http://mock.url' }),
  });

  const res = await request(app)
    .post('/api/order')
    .set('Authorization', `Bearer ${diner.token}`)
    .send({
      franchiseId,
      storeId,
      items: [{ menuId, description: 'pizza', price: 0.01 }],
    });

  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('order');
  expect(res.body).toHaveProperty('jwt');
});