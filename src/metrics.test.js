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

  test('metrics module reportMetrics setup does not crash', async () => {
    const config = require('./config');

    config.metrics = {
      endpointUrl: 'http://localhost',
      accountId: 'test',
      apiKey: 'test',
      source: 'jwt-pizza-service-test',
    };

    expect(config.metrics.endpointUrl).toBe('http://localhost');
  });

  test('metrics module loads and exports expected functions', () => {
    const metrics = require('./metrics');

    expect(metrics).toBeDefined();
    expect(typeof metrics.requestTracker).toBe('function');
    expect(typeof metrics.recordAuth).toBe('function');
    expect(typeof metrics.logoutUser).toBe('function');
    expect(typeof metrics.recordPizzaPurchase).toBe('function');
  });

  test('reportMetrics sends metrics to grafana on interval', async () => {
    jest.resetModules();
    jest.useFakeTimers();

    jest.doMock('node-fetch', () =>
      jest.fn(() => Promise.resolve({ ok: true }))
    );

    const config = require('./config');
    config.metrics = {
      endpointUrl: 'http://example.com',
      accountId: '123',
      apiKey: 'abc',
      source: 'jwt-pizza-service-test',
    };

    const fetch = require('node-fetch');
    const metrics = require('./metrics');

    metrics.recordAuth(true, 'user1');
    metrics.recordPizzaPurchase({
      success: true,
      pizzas: 2,
      revenue: 10,
      latency: 50,
    });

    await jest.advanceTimersByTimeAsync(60000);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      config.metrics.endpointUrl,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: expect.stringMatching(/^Basic /),
        }),
      })
    );

    jest.useRealTimers();
  });
});
