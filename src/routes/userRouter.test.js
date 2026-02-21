const request = require('supertest');
const app = require('../service');
const { Role, DB } = require('../database/database');

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

async function registerUser(password = 'a') {
  const user = {
    name: randomName(),
    email: `${randomName()}@test.com`,
    password,
  };
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
  await DB.addUser(user); // bootstrap admin (hint from guide)
  const token = await login(user.email, password);
  return { ...user, token };
}

let diner;
let admin;

beforeAll(async () => {
  diner = await registerUser('dinerpw');
  admin = await createAdmin();
});

test('GET /api/user/me returns authenticated user', async () => {
  const res = await request(app)
    .get('/api/user/me')
    .set('Authorization', `Bearer ${diner.token}`);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({
    id: diner.id,
    email: diner.email,
    name: diner.name,
  });
});

test('PUT /api/user/:id lets user update self', async () => {
  const newName = `name-${randomName()}`;
  const res = await request(app)
    .put(`/api/user/${diner.id}`)
    .set('Authorization', `Bearer ${diner.token}`)
    .send({ name: newName, email: diner.email, password: diner.password });

  expect(res.status).toBe(200);
  expect(res.body.user).toMatchObject({
    id: diner.id,
    name: newName,
    email: diner.email,
  });
  expect(res.body.token).toMatch(
    /^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/
  );
});

test('PUT /api/user/:id blocks non-admin updating other user', async () => {
  const other = await registerUser('otherpw');

  const res = await request(app)
    .put(`/api/user/${other.id}`)
    .set('Authorization', `Bearer ${diner.token}`)
    .send({
      name: `hack-${randomName()}`,
      email: other.email,
      password: other.password,
    });

  expect(res.status).toBe(403);
});

test('PUT /api/user/:id allows admin updating other user', async () => {
  const other = await registerUser('otherpw2');

  const res = await request(app)
    .put(`/api/user/${other.id}`)
    .set('Authorization', `Bearer ${admin.token}`)
    .send({
      name: `adminedit-${randomName()}`,
      email: other.email,
      password: other.password,
    });

  expect(res.status).toBe(200);
  expect(res.body.user.id).toBe(other.id);
});
