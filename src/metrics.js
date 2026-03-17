const os = require('os');
const fetch = require('node-fetch');
const config = require('./config');

const metricsState = {
  requests: {
    total: 0,
    GET: 0,
    POST: 0,
    PUT: 0,
    DELETE: 0,
  },
  auth: {
    success: 0,
    failure: 0,
  },
  pizzas: {
    sold: 0,
    failures: 0,
    revenue: 0,
  },
  latency: {
    endpoints: [],
    pizzaCreation: [],
  },
  activeUsers: new Set(),
};

function requestTracker(req, res, next) {
  const start = Date.now();

  metricsState.requests.total++;

  if (metricsState.requests[req.method] !== undefined) {
    metricsState.requests[req.method]++;
  }

  res.on('finish', () => {
    const duration = Date.now() - start;
    metricsState.latency.endpoints.push(duration);
  });

  next();
}

function recordAuth(success, userId = null) {
  if (success) {
    metricsState.auth.success++;
    if (userId) metricsState.activeUsers.add(userId);
  } else {
    metricsState.auth.failure++;
  }
}

function logoutUser(userId) {
  metricsState.activeUsers.delete(userId);
}

function recordPizzaPurchase({
  success,
  pizzas = 0,
  revenue = 0,
  latency = 0,
}) {
  if (success) {
    metricsState.pizzas.sold += pizzas;
    metricsState.pizzas.revenue += revenue;
  } else {
    metricsState.pizzas.failures++;
  }

  metricsState.latency.pizzaCreation.push(latency);
}

function getCpuUsage() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;

  cpus.forEach((core) => {
    for (const type in core.times) {
      total += core.times[type];
    }
    idle += core.times.idle;
  });

  return 100 - Math.round((idle / total) * 100);
}

function getMemoryUsage() {
  const total = os.totalmem();
  const free = os.freemem();
  return Math.round(((total - free) / total) * 100);
}

async function reportMetrics() {
  if (!config.metrics.endpointUrl) {
    return;
  }

  const payload = {
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            metrics: [
              {
                name: 'active_users',
                gauge: {
                  dataPoints: [
                    {
                      asInt: metricsState.activeUsers.size,
                      timeUnixNano: Date.now() * 1000000,
                    },
                  ],
                },
              },
              {
                name: 'cpu_usage',
                gauge: {
                  dataPoints: [
                    {
                      asInt: getCpuUsage(),
                      timeUnixNano: Date.now() * 1000000,
                    },
                  ],
                },
              },
              {
                name: 'memory_usage',
                gauge: {
                  dataPoints: [
                    {
                      asInt: getMemoryUsage(),
                      timeUnixNano: Date.now() * 1000000,
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  };

  try {
    await fetch(config.metrics.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      auth: `${config.metrics.accountId}:${config.metrics.apiKey}`,
    });
  } catch (err) {
    console.error('Failed to send metrics:', err.message);
  }
}

const metricsReporter = setInterval(reportMetrics, 60000);

if (typeof metricsReporter.unref === 'function') {
  metricsReporter.unref();
}

module.exports = {
  requestTracker,
  recordAuth,
  logoutUser,
  recordPizzaPurchase,
};
