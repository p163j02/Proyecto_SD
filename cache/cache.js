import express from "express";
import { createClient } from "redis";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

// --- Configuración ---
const port = process.env.PORT || 3001;
const redisHost = process.env.REDIS_HOST || "localhost";
const redisPort = process.env.REDIS_PORT || 6379;
const redisUsername = process.env.REDIS_USERNAME;
const redisPassword = process.env.REDIS_PASSWORD;
const mongoUri = process.env.MONGO_CONECTION;
const dbName = process.env.MONGO_DB_NAME || "Waze";
const collectionName = process.env.MONGO_COLLECTION_NAME || "Events";
const cacheTTL = parseInt(process.env.CACHE_TTL_SECONDS || "60", 10); // TTL en segundos

let hitCount = 0;
let missCount = 0;
let totalRequests = 0;

// --- Clientes ---
let redisClient;
let mongoClient;
let dbCollection;

// --- Conexiones ---
async function connectRedis() {
  const redisOptions = {
    socket: {
      host: redisHost,
      port: redisPort,
    },

    ...(redisUsername && { username: redisUsername }),
    ...(redisPassword && { password: redisPassword }),
  };

  redisClient = createClient(redisOptions);

  redisClient.on("error", (err) =>
    console.error("Error en Redis Client:", err)
  );
  redisClient.on("connect", () => console.log("Conectado a Redis"));
  redisClient.on("reconnecting", () => console.log("Reconectando a Redis..."));
  redisClient.on("ready", () => console.log("Cliente Redis listo"));

  try {
    await redisClient.connect();
  } catch (err) {
    console.error("Fallo al conectar inicialmente a Redis:", err);
    process.exit(1);
  }
}

async function connectMongo() {
  if (!mongoUri) {
    throw new Error("MONGO_CONECTION no está definida en .env");
  }
  console.log("Conectando a MongoDB...");
  mongoClient = new MongoClient(mongoUri);
  try {
    await mongoClient.connect();
    const db = mongoClient.db(dbName);
    dbCollection = db.collection(collectionName);
    console.log("Conectado a MongoDB y colección seleccionada.");
  } catch (err) {
    console.error("Fallo al conectar a MongoDB:", err);
    process.exit(1);
  }
}

// --- Lógica de Caché ---

/**
 * Obtiene un evento, primero desde Redis y luego desde MongoDB si no está en caché.
 * @param {string} eventId - El UUID del evento.
 * @returns {Promise<{data: object | null, source: 'CACHE' | 'MONGODB'}>} - El evento y su origen.
 */
async function getEvent(eventId) {
  if (!redisClient?.isOpen) {
    console.error(
      "Redis no está conectado. Intentando obtener de MongoDB directamente."
    );
    return getEventFromMongo(eventId);
  }

  const cacheKey = `event:${eventId}`;
  try {
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      console.log(`Cache HIT para ${eventId}`);
      return { data: JSON.parse(cachedData), source: "CACHE" };
    } else {
      console.log(`Cache MISS para ${eventId}`);
      // No está en caché, buscar en MongoDB
      const mongoResult = await getEventFromMongo(eventId);
      if (mongoResult.data) {
        // Guardar en Redis si se encontró en MongoDB
        try {
          // Usamos EX para el TTL (Time To Live)
          await redisClient.set(cacheKey, JSON.stringify(mongoResult.data), {
            EX: cacheTTL,
          });
          console.log(
            `Evento ${eventId} guardado en caché con TTL ${cacheTTL}s.`
          );
        } catch (redisSetError) {
          console.error(`Error al guardar ${eventId} en Redis:`, redisSetError);
          // Continuar aunque falle el guardado en caché
        }
      }
      return mongoResult;
    }
  } catch (err) {
    console.error(`Error al interactuar con Redis para ${eventId}:`, err);
    // Fallback a MongoDB en caso de error de Redis
    return getEventFromMongo(eventId);
  }
}

/**
 * Obtiene un evento directamente desde MongoDB.
 * @param {string} eventId - El UUID del evento.
 * @returns {Promise<{data: object | null, source: 'MONGODB'}>} - El evento encontrado o null.
 */
async function getEventFromMongo(eventId) {
  if (!dbCollection) {
    console.error("[getEventFromMongo] La conexión a MongoDB no está lista.");
    return { data: null, source: "MONGODB_ERROR" };
  }

  try {
    const query = { uuid: eventId };
    const eventData = await dbCollection.findOne(query);

    if (eventData) {
      console.log(
        `[getEventFromMongo]   - ¡Encontrado! Documento _id: ${eventData._id}`
      );
    } else {
      console.log(`[getEventFromMongo]   - No encontrado en MongoDB.`);
    }

    return {
      data: eventData,
      source: eventData ? "MONGODB" : "MONGODB_NOT_FOUND",
    };
  } catch (mongoError) {
    console.error(
      `[getEventFromMongo] Error al consultar MongoDB para "${eventId}":`,
      mongoError
    );
    return { data: null, source: "MONGODB_ERROR" };
  }
}

// --- Servidor Express ---
const app = express();

app.get("/event/:eventId", async (req, res) => {
  console.log(
    `[HANDLER] Petición recibida para la ruta /event/${req.params.eventId}`
  );

  const eventId = req.params.eventId;
  if (!eventId) {
    return res.status(400).json({ error: "Event ID es requerido" });
  }

  const result = await getEvent(eventId);

  res.setHeader("X-Cache-Status", result.source === "CACHE" ? "HIT" : "MISS");

  totalRequests++;
  if (result.source === "CACHE") {
    hitCount++;
  } else if (result.source.startsWith("MONGODB")) {
    missCount++;
  }

  if (result.data) {
    res.status(200).json(result.data);
  } else {
    const statusCode = result.source.includes("NOT_FOUND") ? 404 : 500;
    res
      .status(statusCode)
      .json({ error: `Evento ${eventId} no encontrado o error interno.` });
  }
});

app.get("/stats", (req, res) => {
  const hitRate =
    totalRequests > 0 ? ((hitCount / totalRequests) * 100).toFixed(2) : 0;
  res.json({
    totalRequests,
    hitCount,
    missCount,
    hitRate: `${hitRate}%`,
  });
});

app.get("/reset-stats", (req, res) => {
  hitCount = 0;
  missCount = 0;
  totalRequests = 0;
  res.send("Stats reset.");
});

// Endpoint de Healthcheck básico
app.get("/health", (req, res) => {
  const redisStatus = redisClient?.isOpen ? "OK" : "Error";
  res.status(200).json({
    status: "OK",
    redis: redisStatus,
    mongo: mongoClient?.isConnected() ? "OK" : "Error",
  });
});

// --- Inicio del Servidor ---
async function startServer() {
  try {
    await connectRedis();
    await connectMongo();

    app.listen(port, () => {
      console.log(`Servicio de Caché escuchando en http://localhost:${port}`);
    });
  } catch (error) {
    console.error("Error al iniciar el servidor de caché:", error);
    process.exit(1);
  }
}

// --- Manejo de Cierre Limpio ---
async function shutdown() {
  console.log("Cerrando conexiones...");
  try {
    if (redisClient?.isOpen) {
      await redisClient.quit();
      console.log("Cliente Redis desconectado.");
    }
  } catch (err) {
    console.error("Error al cerrar Redis:", err);
  }
  try {
    if (mongoClient) {
      await mongoClient.close();
      console.log("Cliente MongoDB desconectado.");
    }
  } catch (err) {
    console.error("Error al cerrar MongoDB:", err);
  }
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

startServer();
