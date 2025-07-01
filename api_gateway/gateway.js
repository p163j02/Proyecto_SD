const express = require("express");
const Redis = require("ioredis");
const { Client } = require("@elastic/elasticsearch");

const app = express();
const PORT = process.env.PORT || 4000;

const redis = new Redis({
  host: process.env.REDIS_HOST || "redis",
  port: process.env.REDIS_PORT || 6379,
});

const esClient = new Client({
  node: process.env.ELASTICSEARCH_URL || "http://elasticsearch:9200",
});

// Función para loguear métricas en un formato estructurado
const logMetric = (metric) => {
  console.log(
    JSON.stringify({
      service: "api_gateway",
      timestamp: new Date().toISOString(),
      ...metric,
    })
  );
};

app.get("/events/by_type/:type", async (req, res) => {
  try {
    const eventType = req.params.type;
    const cacheKey = `query:type:${eventType}`;
    const cachedResult = await redis.get(cacheKey);

    if (cachedResult) {
      // MÉTRICA: Se registra un "hit" en la caché
      logMetric({ cache_event: "hit", key: cacheKey });
      return res
        .status(200)
        .json({ source: "cache", data: JSON.parse(cachedResult) });
    }

    // MÉTRICA: Se registra un "miss" en la caché
    logMetric({ cache_event: "miss", key: cacheKey });

    const response = await esClient.search({
      index: "eventos_waze",
      query: { match: { "tipo_evento.keyword": eventType } },
      size: 100,
    });

    const results = response.hits.hits;

    if (results.length > 0) {
      await redis.set(cacheKey, JSON.stringify(results), "EX", 3600);
    }

    return res.status(200).json({ source: "elasticsearch", data: results });
  } catch (error) {
    logMetric({ event_type: "error", error_message: error.message });
    res.status(500).send("Error interno del servidor");
  }
});

app.listen(PORT, () => {
  logMetric({
    event_type: "server_start",
    message: `API Gateway escuchando en el puerto ${PORT}`,
  });
});
