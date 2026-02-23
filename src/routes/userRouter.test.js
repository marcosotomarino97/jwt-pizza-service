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
  const inserted = await DB.addUser(user);

  const token = await login(user.email, password);
  return { ...inserted, token };
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

describe('GET /api/user (list users)', () => {
  test('returns 401 when no auth token is provided', async () => {
    const res = await request(app).get(
      '/api/user?page=1&limit=10&name=*'
    );

    expect(res.status).toBe(401);
  });
  test('returns 403 for non-admin user', async () => {
  const res = await request(app)
    .get('/api/user?page=1&limit=10&name=*')
    .set('Authorization', `Bearer ${diner.token}`);

  expect(res.status).toBe(403);
});
test('admin receives a list of users', async () => {
  await registerUser('anotherpw');

  const res = await request(app)
    .get('/api/user?page=1&limit=500&name=*')
    .set('Authorization', `Bearer ${admin.token}`);

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.users)).toBe(true);
  expect(res.body.users.length).toBeGreaterThan(0);

  const sample = res.body.users[0];
  expect(sample).toHaveProperty('id');
  expect(sample).toHaveProperty('name');
  expect(sample).toHaveProperty('email');
});


test('paginates users using page and limit', async () => {

  const created = await Promise.all(
    Array.from({ length: 12 }, (_, i) => registerUser(`pw-${i}`))
  );

  const res1 = await request(app)
    .get('/api/user?page=1&limit=5&name=*')
    .set('Authorization', `Bearer ${admin.token}`);

  const res2 = await request(app)
    .get('/api/user?page=2&limit=5&name=*')
    .set('Authorization', `Bearer ${admin.token}`);

  expect(res1.status).toBe(200);
  expect(res2.status).toBe(200);

  expect(res1.body.users.length).toBe(5);
  expect(res2.body.users.length).toBe(5);

  const ids1 = res1.body.users.map(u => u.id);
  const ids2 = res2.body.users.map(u => u.id);

  // Page 1 and 2 should not be the same set
  expect(ids1.some(id => ids2.includes(id))).toBe(false);

  expect(res1.body.more).toBe(true);
});

test('filters users by name', async () => {
  // Create deterministic users
  const matchUser = await registerUser('pw-match');
  const nonMatchUser = await registerUser('pw-other');

  // Rename them so we control names
  await request(app)
    .put(`/api/user/${matchUser.id}`)
    .set('Authorization', `Bearer ${admin.token}`)
    .send({
      name: 'FilterTargetUser',
      email: matchUser.email,
      password: matchUser.password,
    });

  await request(app)
    .put(`/api/user/${nonMatchUser.id}`)
    .set('Authorization', `Bearer ${admin.token}`)
    .send({
      name: 'CompletelyDifferentName',
      email: nonMatchUser.email,
      password: nonMatchUser.password,
    });

  const res = await request(app)
    .get('/api/user?page=1&limit=50&name=FilterTarget')
    .set('Authorization', `Bearer ${admin.token}`);

  expect(res.status).toBe(200);

  const names = res.body.users.map(u => u.name);

  expect(names.some(n => n.includes('FilterTarget'))).toBe(true);
  expect(names.some(n => n.includes('CompletelyDifferentName'))).toBe(false);
});

});
describe('DELETE /api/user/:id', () => {

  test('non-admin cannot delete another user', async () => {
    const other = await registerUser('pw-delete');

    const res = await request(app)
      .delete(`/api/user/${other.id}`)
      .set('Authorization', `Bearer ${diner.token}`);

    expect(res.status).toBe(403);
  });

});
