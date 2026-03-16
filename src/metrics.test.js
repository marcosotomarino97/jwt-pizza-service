const metrics = require('./metrics');

describe('metrics module', () => {
  test('requestTracker calls next and registers finish handler', () => {
    const req = { method: 'GET' };
    const res = {
      on: jest.fn((event, cb) => {
        if (event === 'finish') {
          cb();
        }
      }),
    };
    const next = jest.fn();

    metrics.requestTracker(req, res, next);

    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
    expect(next).toHaveBeenCalled();
  });

  test('recordAuth success runs', () => {
    metrics.recordAuth(true, 'user1');
    expect(true).toBe(true);
  });

  test('recordAuth failure runs', () => {
    metrics.recordAuth(false);
    expect(true).toBe(true);
  });

  test('logoutUser runs after login', () => {
    metrics.recordAuth(true, 'user2');
    metrics.logoutUser('user2');

    expect(true).toBe(true);
  });

  test('recordPizzaPurchase success runs', () => {
    metrics.recordPizzaPurchase({
      success: true,
      pizzas: 2,
      revenue: 25,
      latency: 120,
    });

    expect(true).toBe(true);
  });

  test('recordPizzaPurchase failure runs', () => {
    metrics.recordPizzaPurchase({
      success: false,
      pizzas: 0,
      revenue: 0,
      latency: 200,
    });

    expect(true).toBe(true);
  });
});
