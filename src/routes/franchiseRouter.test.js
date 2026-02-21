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
let franchiseAdmin;
let otherUser;
let franchiseId;
let storeId;

beforeAll(async () => {
  admin = await createAdmin();
  franchiseAdmin = await registerUser('frpw');
  otherUser = await registerUser('otherpw');

  // Create franchise as admin
  const frRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ name: `fr-${randomName()}`, admins: [{ email: franchiseAdmin.email }] });

  expect(frRes.status).toBe(200);
  franchiseId = frRes.body.id;

  // Create store under franchise
  const storeRes = await request(app)
    .post(`/api/franchise/${franchiseId}/store`)
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ franchiseId, name: `store-${randomName()}` });

  expect(storeRes.status).toBe(200);
  storeId = storeRes.body.id;
});

test('non-admin cannot create franchise', async () => {
  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${otherUser.token}`)
    .send({ name: `bad-${randomName()}`, admins: [] });

  expect(res.status).toBe(403);
});

test('GET /api/franchise works', async () => {
  const res = await request(app).get('/api/franchise?page=0&limit=10&name=*');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('franchises');
});

test('GET /api/franchise/:userId returns user franchises', async () => {
  const res = await request(app)
    .get(`/api/franchise/${franchiseAdmin.id}`)
    .set('Authorization', `Bearer ${franchiseAdmin.token}`);

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('DELETE store works', async () => {
  const res = await request(app)
    .delete(`/api/franchise/${franchiseId}/store/${storeId}`)
    .set('Authorization', `Bearer ${admin.token}`);

  expect(res.status).toBe(200);
});

test('DELETE franchise works', async () => {
  const res = await request(app)
    .delete(`/api/franchise/${franchiseId}`)
    .set('Authorization', `Bearer ${admin.token}`);

  expect(res.status).toBe(200);
});