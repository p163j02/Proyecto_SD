import { MongoClient } from "mongodb";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { setTimeout } from "timers/promises";
import fs from "fs";
import path from "path";

dotenv.config();

// --- Configuración ---
const mongoUri = process.env.MONGO_CONECTION;
const dbName = process.env.MONGO_DB_NAME || "Waze";
const collectionName = process.env.MONGO_COLLECTION_NAME || "Events";
const cacheServiceUrl =
  process.env.CACHE_SERVICE_URL || "http://localhost:3001/event";
const totalQueries = parseInt(process.env.TOTAL_QUERIES || "1000", 10);
const queriesPerSecondDist1 = parseInt(
  process.env.QUERIES_PER_SECOND_DIST1 || "5",
  10
);
const meanArrivalTimeDist2Ms = parseInt(
  process.env.MEAN_ARRIVAL_TIME_DIST2_MS || "150",
  10
);

// Leer configuración de Redis desde ENV (para guardar en CSV)
const redisPolicy = process.env.REDIS_POLICY || "N/A";
const redisMaxMemory = process.env.REDIS_MAXMEMORY || "N/A";
const resultsFilePath = path.join(
  process.cwd(),
  "results",
  "simulation_results_popularity.csv"
);

// --- Clientes y Estado Global ---
let mongoClient;
let dbCollection;
let eventPoolWithScores = [];
let finalStats = { hits: 0, misses: 0, errors: 0, total: 0 };

// --- Funciones Auxiliares ---

function getPoissonDelay(meanMs) {
  return -Math.log(1.0 - Math.random()) * meanMs;
}

/**
 * @param {object} event - El objeto del evento con campos como type, reliability, etc.
 * @returns {number} - Un puntaje numérico (mayor es más importante/probable).
 */
function calculatePopularityScore(event) {
  let score = 1; // Puntaje base mínimo para eventos "poco interesantes"

  // --- Puntajes Base por Tipo (Diferencias Enormes) ---
  let baseScore = 1;
  switch (event.type) {
    case "ROAD_CLOSED":
      baseScore = 500;
      break;
    case "ACCIDENT":
      baseScore = 100;
      break;
    case "JAM":
      if (event.subtype === "JAM_STAND_STILL_TRAFFIC") baseScore = 50;
      else if (event.subtype === "JAM_HEAVY_TRAFFIC") baseScore = 20;
      else baseScore = 5;
      break;
    case "HAZARD":
      if (
        event.subtype === "HAZARD_ON_ROAD_OBJECT" ||
        event.subtype === "HAZARD_POTHOLE"
      )
        baseScore = 5;
      else baseScore = 1;
      break;
    case "POLICE":
      baseScore = 1;
      break;
    default:
      baseScore = 1;
  }
  score = baseScore;

  // --- Multiplicadores por Confirmación (Solo para scores base ya elevados y alta confirmación) ---

  // Solo aplicamos multiplicadores fuertes si el evento ya es algo importante (score base > 5)
  if (baseScore > 5) {
    let reliabilityMultiplier = 1.0;
    if (event.reliability && event.reliability >= 9) {
      reliabilityMultiplier = 3.0 + (event.reliability - 9);
    } else if (event.reliability && event.reliability === 8) {
      reliabilityMultiplier = 1.5;
    }

    let thumbsUpMultiplier = 1.0;
    if (event.nThumbsUp && event.nThumbsUp >= 10) {
      thumbsUpMultiplier = 2.5; // Multiplicador fuerte por muchos votos
    } else if (event.nThumbsUp && event.nThumbsUp >= 5) {
      thumbsUpMultiplier = 1.5; // Multiplicador moderado
    }

    // Aplicar multiplicadores solo si son mayores que 1
    if (reliabilityMultiplier > 1.0) {
      score *= reliabilityMultiplier;
    }
    if (thumbsUpMultiplier > 1.0) {
      score *= thumbsUpMultiplier;
    }
  }

  return Math.max(1, Math.round(score));
}

async function connectToMongoAndGetIds() {
  if (!mongoUri) {
    throw new Error("MONGO_CONECTION no está definida en .env");
  }
  console.log("Conectando a MongoDB...");
  mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();
  const db = mongoClient.db(dbName);
  dbCollection = db.collection(collectionName);
  console.log("Conectado a MongoDB. Obteniendo y puntuando eventos...");

  const sampleSize = Math.min(totalQueries * 5, 10000);
  console.log(`[Connect] Obteniendo ${sampleSize} eventos de muestra...`);
  const sampleCursor = dbCollection.aggregate([
    { $sample: { size: sampleSize } },
    {
      $project: {
        _id: 0,
        uuid: 1,
        type: 1,
        subtype: 1,
        reliability: 1,
        nThumbsUp: 1,
      },
    },
  ]);

  const events = await sampleCursor.toArray();
  eventPoolWithScores = [];

  console.log(`[Connect] Calculando puntajes para ${events.length} eventos...`);
  for (const event of events) {
    if (event.uuid) {
      const score = calculatePopularityScore(event);
      eventPoolWithScores.push({ uuid: event.uuid, score: score });
    }
  }

  console.log(
    `[Connect] Calculando estadísticas de scores para ${eventPoolWithScores.length} eventos puntuables...`
  );
  const scores = eventPoolWithScores.map((e) => e.score);

  if (scores.length > 0) {
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

    const highScoresCount = scores.filter((s) => s > 10).length;
    console.log(
      `[Connect] Estadísticas de Scores: Min=<span class="math-inline">\{minScore\.toFixed\(2\)\}, Max\=</span>{maxScore.toFixed(2)}, Avg=${avgScore.toFixed(
        2
      )}`
    );
    console.log(
      `[Connect] Eventos con Score > 10: ${highScoresCount} de ${scores.length}`
    );
  } else {
    console.log(
      "[Connect] No hay scores para calcular estadísticas (eventPoolWithScores está vacío o todos tienen score <= 0)."
    );
  }

  eventPoolWithScores = eventPoolWithScores.filter((e) => e.score > 0);

  if (eventPoolWithScores.length === 0) {
    console.warn(
      "No se encontraron eventos válidos o puntuables en la base de datos."
    );
    throw new Error("No hay IDs de eventos puntuables para consultar.");
  }

  console.log(
    `[Connect] Se procesaron ${eventPoolWithScores.length} eventos con puntaje para la simulación.`
  );
}

/**
 * Envía una consulta al servicio de caché y actualiza las estadísticas.
 * @param {string} eventId - El UUID del evento a consultar.
 * @param {object} stats - El objeto de estadísticas para actualizar.
 */
async function sendQueryToCache(eventId, stats) {
  const url = `${cacheServiceUrl}/${eventId}`;
  try {
    const startTime = performance.now();
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    const endTime = performance.now();
    const duration = (endTime - startTime).toFixed(2);

    stats.total++;
    if (response.ok) {
      const cacheStatus = response.headers.get("X-Cache-Status") || "UNKNOWN";
      if (cacheStatus === "HIT") {
        stats.hits++;
      } else if (cacheStatus === "MISS") {
        stats.misses++;
      }
    } else {
      stats.errors++;
      console.error(
        `Error al consultar ${eventId}: ${response.status} ${response.statusText} en ${duration} ms`
      );
    }
  } catch (error) {
    stats.total++;
    stats.errors++;
    if (error.name === "TimeoutError") {
      console.error(`Timeout al consultar ${eventId}`);
    } else {
      console.error(`Error de red al consultar ${eventId}: ${error.message}`);
    }
  }
}

/**
 * Selecciona un ID de evento al azar, ponderado por el puntaje de popularidad.
 * @returns {string | null} - Un UUID de evento o null si no hay eventos.
 */
function getWeightedRandomEventId() {
  if (eventPoolWithScores.length === 0) {
    return null;
  }

  let totalScore = 0;
  for (const event of eventPoolWithScores) {
    totalScore += event.score;
  }

  if (totalScore <= 0) {
    const randomIndex = Math.floor(Math.random() * eventPoolWithScores.length);
    return eventPoolWithScores[randomIndex].uuid;
  }

  const randomThreshold = Math.random() * totalScore;

  let cumulativeScore = 0;
  for (const event of eventPoolWithScores) {
    cumulativeScore += event.score;
    if (cumulativeScore >= randomThreshold) {
      return event.uuid;
    }
  }

  return eventPoolWithScores[eventPoolWithScores.length - 1].uuid;
}

// --- Simuladores de Tráfico ---

/**
 * Simula tráfico con una tasa de arribo constante.
 */
async function simulateConstantRate() {
  console.log(
    `\n--- Iniciando Simulación: Tasa Constante (${queriesPerSecondDist1} qps) ---`
  );
  const delayBetweenQueries = 1000 / queriesPerSecondDist1;
  let queriesSent = 0;
  console.log(`[Simulate] Iniciando bucle. totalQueries = ${totalQueries}`);

  while (queriesSent < totalQueries) {
    const eventId = getWeightedRandomEventId(); //
    if (eventId) {
      await sendQueryToCache(eventId, finalStats);
      queriesSent++;
      if (queriesSent % 100 === 0 || queriesSent === totalQueries) {
        console.log(`Progreso (Constante): ${queriesSent}/${totalQueries}`);
      }
    } else {
      console.warn("[Simulate] getWeightedRandomEventId devolvió null.");
      break;
    }
    await setTimeout(delayBetweenQueries);
  }
  console.log("--- Simulación (Tasa Constante) Finalizada ---");
}

/**
 * Simula tráfico con una tasa de arribo siguiendo una distribución de Poisson.
 */
async function simulatePoissonRate() {
  console.log(
    `\n--- Iniciando Simulación: Distribución de Poisson (Media: ${meanArrivalTimeDist2Ms} ms) ---`
  );
  let queriesSent = 0;
  console.log(`[Simulate] Iniciando bucle. totalQueries = ${totalQueries}`);

  while (queriesSent < totalQueries) {
    const eventId = getWeightedRandomEventId(); //
    if (eventId) {
      await sendQueryToCache(eventId, finalStats);
      queriesSent++;
      if (queriesSent % 100 === 0 || queriesSent === totalQueries) {
        console.log(`Progreso (Poisson): ${queriesSent}/${totalQueries}`);
      }
    } else {
      console.warn("[Simulate] getWeightedRandomEventId devolvió null.");
      break;
    }
    const delay = getPoissonDelay(meanArrivalTimeDist2Ms);
    await setTimeout(delay);
  }
  console.log("--- Simulación (Poisson) Finalizada ---");
}

async function main() {
  try {
    await connectToMongoAndGetIds();

    const simulationsToRun = [
      { name: "ConstantRate", func: simulateConstantRate },
      { name: "PoissonRate", func: simulatePoissonRate },
    ];

    console.log(
      `\n--- Iniciando Set de Experimentos con Config Redis: Policy=${redisPolicy}, MaxMemory=${redisMaxMemory} ---`
    );

    for (const sim of simulationsToRun) {
      console.log(`\n===== Ejecutando Simulación: ${sim.name} =====`);
      finalStats = { hits: 0, misses: 0, errors: 0, total: 0 };

      await sim.func();

      console.log(`--- Simulación ${sim.name} Finalizada ---`);

      const hitRate =
        finalStats.total > 0
          ? ((finalStats.hits / finalStats.total) * 100).toFixed(2)
          : 0;
      const csvHeader =
        "Timestamp,RedisPolicy,RedisMaxMemory,SimulationType,TotalQueries,CacheHits,CacheMisses,Errors,HitRatePercent\n";
      const csvLine = `${new Date().toISOString()},${redisPolicy},${redisMaxMemory},${
        sim.name
      },${finalStats.total},${finalStats.hits},${finalStats.misses},${
        finalStats.errors
      },${hitRate}\n`;

      if (!fs.existsSync(resultsFilePath)) {
        try {
          fs.writeFileSync(resultsFilePath, csvHeader, "utf8");
          console.log(`Archivo de resultados creado: ${resultsFilePath}`);
        } catch (writeError) {
          console.error(
            `Error al crear archivo de resultados: ${writeError.message}`
          );
        }
      }

      try {
        fs.appendFileSync(resultsFilePath, csvLine, "utf8");
        console.log(
          `Resultados de la simulación [${sim.name}] añadidos a: ${resultsFilePath}`
        );
      } catch (appendError) {
        console.error(
          `Error al añadir resultados [${sim.name}] al archivo: ${appendError.message}`
        );
      }

      console.log(`\n--- Estadísticas Finales [${sim.name}] ---`);
      console.log(`Consultas Totales: ${finalStats.total}`);
      console.log(`Cache Hits: ${finalStats.hits}`);
      console.log(`Cache Misses: ${finalStats.misses}`);
      console.log(`Errores: ${finalStats.errors}`);
      console.log(`Hit Rate: ${hitRate}%`);
      console.log("---------------------------------");
    }
  } catch (error) {
    console.error("Error fatal en el generador de tráfico:", error);
  } finally {
    if (mongoClient) {
      try {
        await mongoClient.close();
        console.log("Conexión a MongoDB cerrada.");
      } catch (closeError) {
        console.error("Error al cerrar conexión MongoDB:", closeError);
      }
    }
    console.log(
      "\nGenerador de tráfico terminado (todas las simulaciones completadas)."
    );
  }
}

main();
