const fetch = require('node-fetch');

const config = (() => {
  try {
    return require('./config.js');
  } catch (_e) {
    return require('./config.template.js');
  }
})();

class Logger {
  sanitize(value) {
    const secretKeys = new Set([
      'password',
      'token',
      'jwt',
      'authorization',
      'apiKey',
      'api_key',
      'DB_PASSWORD',
      'LOGGING_API_KEY',
      'METRICS_API_KEY',
      'FACTORY_API_KEY',
    ]);

    const redact = (obj) => {
      if (obj === null || obj === undefined) return obj;

      if (Array.isArray(obj)) {
        return obj.map(redact);
      }

      if (typeof obj === 'object') {
        const clean = {};
        for (const [key, val] of Object.entries(obj)) {
          clean[key] = secretKeys.has(key) ? '****' : redact(val);
        }
        return clean;
      }

      return obj;
    };

    return redact(value);
  }

  serialize(value) {
    try {
      if (typeof value === 'string') {
        return value;
      }
      return JSON.stringify(this.sanitize(value));
    } catch {
      return JSON.stringify({ message: 'unable to serialize log payload' });
    }
  }

  async log({ level = 'info', type = 'app', message = '', metadata = {} }) {
    if (
      !config.logging?.endpointUrl ||
      !config.logging?.accountId ||
      !config.logging?.apiKey
    ) {
      return;
    }

    const payload = {
      streams: [
        {
          stream: {
            source: config.logging.source || 'jwt-pizza-service',
            level,
            type,
          },
          values: [
            [
              `${Date.now() * 1000000}`,
              this.serialize({
                message,
                ...this.sanitize(metadata),
              }),
            ],
          ],
        },
      ],
    };

    try {
      const res = await fetch(config.logging.endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:
            'Basic ' +
            Buffer.from(
              `${config.logging.accountId}:${config.logging.apiKey}`
            ).toString('base64'),
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error('Failed to send log to Grafana:', text);
      }
    } catch (err) {
      console.error('Failed to send log to Grafana:', err.message);
    }
  }

  httpLogger = (req, res, next) => {
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    let responseBody;

    res.json = (body) => {
      responseBody = body;
      return originalJson(body);
    };

    res.send = (body) => {
      responseBody = body;
      return originalSend(body);
    };

    res.on('finish', () => {
      let parsedResBody = responseBody;

      try {
        if (typeof parsedResBody === 'string') {
          parsedResBody = JSON.parse(parsedResBody);
        }
      } catch (_e) {
        // ignore parse errors
      }

      this.log({
        level:
          res.statusCode >= 500
            ? 'error'
            : res.statusCode >= 400
              ? 'warn'
              : 'info',
        type: 'http',
        message: 'HTTP request',
        metadata: {
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          authorized: !!req.headers.authorization,
          reqBody: this.sanitize(req.body),
          resBody: this.sanitize(parsedResBody),
        },
      });
    });

    next();
  };

  async logDb(sql, params, durationMs = null) {
    await this.log({
      level: 'info',
      type: 'db',
      message: 'Database query',
      metadata: {
        sql,
        params,
        durationMs,
      },
    });
  }

  async logFactory(requestBody, responseBody, statusCode) {
    await this.log({
      level: statusCode >= 400 ? 'warn' : 'info',
      type: 'factory',
      message: 'Factory request',
      metadata: {
        requestBody,
        responseBody,
        statusCode,
      },
    });
  }

  async logException(err, req = null) {
    await this.log({
      level: 'error',
      type: 'exception',
      message: err.message || 'Unhandled exception',
      metadata: {
        path: req?.originalUrl,
        method: req?.method,
        stack: err.stack,
      },
    });
  }
}

module.exports = new Logger();
