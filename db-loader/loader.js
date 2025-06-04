import { MongoClient } from "mongodb";
import { readFileSync } from "fs";
import { performance } from "perf_hooks";
import path from "path";
import { fileURLToPath } from "url";

async function bulkInsert() {
  const uri = process.env.MONGO_CONECTION;
  console.log("DEBUG: Intentando conectar a MongoDB URI:", uri);
  const client = new MongoClient(uri, {
    maxPoolSize: 10,
    connectTimeoutMS: 5000,
  });

  try {
    await client.connect();
    const db = client.db("Waze");
    const collection = db.collection("Events");

    console.log("Construyendo ruta al archivo JSON...");

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    const filePath = path.join(__dirname, "data", "waze_50k_events.json");

    console.log(`Leyendo archivo desde: ${filePath}`);
    const rawData = readFileSync(filePath, "utf8");
    const documents = JSON.parse(rawData);

    console.log(`Preparando ${documents.length} documentos...`);
    const batchSize = 500;
    let inserted = 0;

    const start = performance.now();

    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);
      await collection.insertMany(batch, { ordered: false });
      inserted += batch.length;
      console.log(
        `Progreso: ${inserted}/${documents.length} (${Math.round(
          (inserted / documents.length) * 100
        )}%)`
      );
    }

    const duration = (performance.now() - start) / 1000;
    console.log(
      `\nInsertados ${inserted} documentos en ${duration.toFixed(2)} segundos`
    );
    console.log(`Rendimiento: ${Math.round(inserted / duration)} ops/s`);

    // Crear índices después de la inserción
    console.log("Creando índices...");
    await collection.createIndex({ uuid: 1 }, { unique: true });
    await collection.createIndex({ location: "2dsphere" });
    await collection.createIndex({ pubMillis: 1 });
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await client.close();
  }
}

bulkInsert();
