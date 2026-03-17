const os = require('os');
const fetch = require('node-fetch');

const config = (() => {
  try {
    return require('./config.js');
  } catch (_e) {
    return require('./config.template.js');
  }
})();

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
    endpointsTotal: 0,
    pizzaCreationTotal: 0,
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
    metricsState.latency.endpointsTotal += duration;
  });

  next();
}

function recordAuth(success, userId = null) {
  if (success) {
    metricsState.auth.success++;
    if (userId) {
      metricsState.activeUsers.add(userId);
    }
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

  metricsState.latency.pizzaCreationTotal += latency;
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

function metricDataPoint(value) {
  return {
    asInt: Math.round(value),
    timeUnixNano: Date.now() * 1000000,
    attributes: [
      {
        key: 'source',
        value: { stringValue: config.metrics.source },
      },
    ],
  };
}

function makeGaugeMetric(name, value, unit = '1') {
  return {
    name,
    unit,
    gauge: {
      dataPoints: [metricDataPoint(value)],
    },
  };
}

function makeSumMetric(name, value, unit = '1') {
  return {
    name,
    unit,
    sum: {
      dataPoints: [metricDataPoint(value)],
      aggregationTemporality: 'AGGREGATION_TEMPORALITY_CUMULATIVE',
      isMonotonic: true,
    },
  };
}

async function reportMetrics() {
  if (!config.metrics.endpointUrl) {
    return;
  }

  const metrics = [
    makeSumMetric('requests_total', metricsState.requests.total, '1'),
    makeSumMetric('requests_get_total', metricsState.requests.GET, '1'),
    makeSumMetric('requests_post_total', metricsState.requests.POST, '1'),
    makeSumMetric('requests_put_total', metricsState.requests.PUT, '1'),
    makeSumMetric('requests_delete_total', metricsState.requests.DELETE, '1'),

    makeSumMetric('auth_success_total', metricsState.auth.success, '1'),
    makeSumMetric('auth_failure_total', metricsState.auth.failure, '1'),

    makeGaugeMetric('active_users', metricsState.activeUsers.size, '1'),
    makeGaugeMetric('cpu_usage', getCpuUsage(), '%'),
    makeGaugeMetric('memory_usage', getMemoryUsage(), '%'),

    makeSumMetric('pizzas_sold_total', metricsState.pizzas.sold, '1'),
    makeSumMetric('pizza_failures_total', metricsState.pizzas.failures, '1'),
    makeSumMetric('pizza_revenue_total', metricsState.pizzas.revenue, '1'),
    
    makeSumMetric(
      'request_latency_ms_total',
      metricsState.latency.endpointsTotal,
      'ms'
    ),
    makeSumMetric(
      'pizza_latency_ms_total',
      metricsState.latency.pizzaCreationTotal,
      'ms'
    ),
  ];

  const payload = {
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            metrics,
          },
        ],
      },
    ],
  };

  try {
    const response = await fetch(config.metrics.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:
          'Basic ' +
          Buffer.from(
            `${config.metrics.accountId}:${config.metrics.apiKey}`
          ).toString('base64'),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Failed to send metrics:', text);
    }
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