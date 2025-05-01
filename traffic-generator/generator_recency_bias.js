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

// LEER CONFIGURACIÓN DE REDIS DESDE ENV
const redisPolicy = process.env.REDIS_POLICY || "N/A";
const redisMaxMemory = process.env.REDIS_MAXMEMORY || "N/A";
const resultsFilePath = path.join(
  process.cwd(),
  "results",
  "simulation_results_recency.csv"
);

// --- Clientes y Estado Global ---
let mongoClient;
let dbCollection;
let eventIds = [];
// Objeto para guardar estadísticas globales de la simulación actual
let finalStats = { hits: 0, misses: 0, errors: 0, total: 0 };

// --- Variables para Sesgo de Recencia ---
const RECENCY_LIST_SIZE = 50; // Cuántos IDs recientes recordar (ajustable)
const RECENCY_BIAS_PROBABILITY = 0.8; // Probabilidad (0-1) de elegir un ID reciente
let recentlyRequestedIds = []; // Lista de IDs solicitados recientemente

// --- Funciones Auxiliares ---

/**
 * Genera un delay basado en una distribución de Poisson (Exponencial entre arribos).
 * @param {number} meanMs - Tiempo medio de arribo en milisegundos.
 * @returns {number} - Delay en milisegundos.
 */
function getPoissonDelay(meanMs) {
  return -Math.log(1.0 - Math.random()) * meanMs;
}

/**
 * Se conecta a MongoDB y obtiene una lista de IDs de eventos existentes.
 */
async function connectToMongoAndGetIds() {
  if (!mongoUri) {
    throw new Error("MONGO_CONECTION no está definida en .env");
  }
  console.log("Conectando a MongoDB...");
  mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();
  const db = mongoClient.db(dbName);
  dbCollection = db.collection(collectionName);
  console.log("Conectado a MongoDB. Obteniendo IDs de eventos...");

  const sampleSize = Math.min(totalQueries * 2, 5000);
  console.log(
    `[Debug] totalQueries = ${totalQueries}, sampleSize = ${sampleSize}`
  );
  const sampleCursor = dbCollection.aggregate([
    { $sample: { size: sampleSize } },
    { $project: { _id: 0, uuid: 1 } },
  ]);
  eventIds = (await sampleCursor.toArray())
    .map((doc) => doc.uuid)
    .filter(Boolean);

  console.log(
    `[connectToMongoAndGetIds] Se obtuvieron ${eventIds.length} IDs de eventos.`
  );

  if (eventIds.length === 0) {
    console.warn("No se encontraron IDs de eventos en la base de datos.");
    throw new Error("No hay IDs de eventos para consultar.");
  }
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

    // Actualizar estadísticas
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
 * Selecciona un ID de evento con sesgo de recencia.
 * Con alta probabilidad elige uno de los últimos IDs solicitados,
 * con baja probabilidad elige uno completamente aleatorio.
 * También actualiza la lista de recientes.
 * @returns {string | null} - Un UUID de evento o null si no hay IDs.
 */
function getBiasedEventId() {
  if (eventIds.length === 0) {
    return null; // No hay IDs base disponibles
  }

  let chosenId = null;

  // Decidir si elegir uno reciente o uno completamente nuevo
  if (
    recentlyRequestedIds.length > 0 &&
    Math.random() < RECENCY_BIAS_PROBABILITY
  ) {
    // Elegir uno de la lista de recientes al azar
    const randomIndex = Math.floor(Math.random() * recentlyRequestedIds.length);
    chosenId = recentlyRequestedIds[randomIndex];
  } else {
    // Elegir uno completamente aleatorio de la lista principal
    const randomIndex = Math.floor(Math.random() * eventIds.length);
    chosenId = eventIds[randomIndex];
  }

  // Actualizar la lista de recientes:
  // Añadir el ID elegido (si no está ya) y mantener el tamaño máximo.
  if (chosenId) {
    // Eliminar si ya existe para moverlo al final (más reciente)
    const existingIndex = recentlyRequestedIds.indexOf(chosenId);
    if (existingIndex > -1) {
      recentlyRequestedIds.splice(existingIndex, 1);
    }
    // Añadir al final (más reciente)
    recentlyRequestedIds.push(chosenId);
    // Mantener el tamaño máximo de la lista
    if (recentlyRequestedIds.length > RECENCY_LIST_SIZE) {
      recentlyRequestedIds.shift(); // Eliminar el más antiguo (primero en la lista)
    }
  }

  return chosenId;
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
    const eventId = getBiasedEventId();
    if (eventId) {
      await sendQueryToCache(eventId, finalStats);
      queriesSent++;

      if (queriesSent % 100 === 0 || queriesSent === totalQueries) {
        console.log(`Progreso (Constante): ${queriesSent}/${totalQueries}`);
      }
    } else {
      console.warn(
        "[Simulate] getRandomEventId devolvió null. Terminando simulación."
      );
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

  console.log(`[Simulate] Iniciando bucle. totalQueries = ${totalQueries}`); // Log añadido

  while (queriesSent < totalQueries) {
    const eventId = getBiasedEventId();
    if (eventId) {
      await sendQueryToCache(eventId, finalStats);
      queriesSent++;

      if (queriesSent % 100 === 0 || queriesSent === totalQueries) {
        console.log(`Progreso (Poisson): ${queriesSent}/${totalQueries}`);
      }
    } else {
      console.warn(
        "[Simulate] getRandomEventId devolvió null. Terminando simulación."
      );
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
