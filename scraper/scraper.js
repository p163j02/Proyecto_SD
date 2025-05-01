import fetch from "node-fetch";
import { writeFileSync, appendFileSync, readFileSync } from "fs";
import { setTimeout } from "timers/promises";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const now = new Date();
const timestamp = now.toISOString().replace(/[:.]/g, "-");
const dynamicOutputFilename = `waze_events_${timestamp}.json`;

const outputFilePath = path.join(
  __dirname,
  "scraped_data",
  dynamicOutputFilename
);

// Configuración para 10,000 eventos
const config = {
  baseUrl: "https://www.waze.com/live-map/api/georss",
  outputFile: outputFilePath,
  targetEvents: 15000,
  initialRequestDelay: 1500,
  maxParallelRequests: 5,
  areaSize: 0.03,
  moveStep: 0.02,
  retryLimit: 3,
  regions: [
    // Coordenadas que cubren toda la Región Metropolitana
    { name: "Norte", top: -33.35, bottom: -33.4, left: -70.7, right: -70.6 },
    { name: "Centro", top: -33.4, bottom: -33.5, left: -70.75, right: -70.65 },
    { name: "Sur", top: -33.5, bottom: -33.6, left: -70.8, right: -70.7 },
    {
      name: "Oriente",
      top: -33.42,
      bottom: -33.48,
      left: -70.55,
      right: -70.45,
    },
    {
      name: "Poniente",
      top: -33.45,
      bottom: -33.55,
      left: -70.85,
      right: -70.75,
    },
  ],
};

// Estado global
const collectedEvents = new Map();
let totalCollected = 0;
let requestCount = 0;
let currentRegionIndex = 0;

// Headers con rotación de User-Agent
const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
];

function getHeaders() {
  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "es-ES,es;q=0.9",
    Referer: "https://www.waze.com/es-419/live-map/",
    "User-Agent": userAgents[Math.floor(Math.random() * userAgents.length)],
  };
}

// Sistema de coordenadas en espiral para cada región
class RegionScanner {
  constructor(region) {
    this.region = region;
    this.currentCenter = {
      lat: (region.top + region.bottom) / 2,
      lng: (region.left + region.right) / 2,
    };
    this.spiralDirection = 0;
    this.spiralLength = 1;
    this.spiralPosition = 0;
  }

  move() {
    const directions = [
      { lat: 0, lng: 1 }, // Este
      { lat: -1, lng: 0 }, // Sur
      { lat: 0, lng: -1 }, // Oeste
      { lat: 1, lng: 0 }, // Norte
    ];

    const direction = directions[this.spiralDirection];
    this.currentCenter.lat += direction.lat * config.moveStep;
    this.currentCenter.lng += direction.lng * config.moveStep;

    this.spiralPosition++;
    if (this.spiralPosition >= this.spiralLength) {
      this.spiralPosition = 0;
      this.spiralDirection = (this.spiralDirection + 1) % 4;
      if (this.spiralDirection % 2 === 0) {
        this.spiralLength++;
      }
    }
  }

  getCurrentBounds() {
    const halfSize = config.areaSize / 2;
    return {
      top: Math.min(this.currentCenter.lat + halfSize, this.region.top),
      bottom: Math.max(this.currentCenter.lat - halfSize, this.region.bottom),
      left: Math.max(this.currentCenter.lng - halfSize, this.region.left),
      right: Math.min(this.currentCenter.lng + halfSize, this.region.right),
      region: this.region.name,
    };
  }
}

const regionScanners = config.regions.map(
  (region) => new RegionScanner(region)
);

async function fetchWithRetry(url, retries = config.retryLimit) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        headers: getHeaders(),
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        if (response.status === 429) {
          // Too Many Requests
          await setTimeout(10000 * (i + 1));
          continue;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      await setTimeout(5000 * (i + 1));
    }
  }
}

async function processArea(bounds) {
  const url = new URL(config.baseUrl);
  url.searchParams.append("top", bounds.top);
  url.searchParams.append("bottom", bounds.bottom);
  url.searchParams.append("left", bounds.left);
  url.searchParams.append("right", bounds.right);
  url.searchParams.append("env", "row");
  url.searchParams.append("types", "alerts");

  try {
    const data = await fetchWithRetry(url.toString());
    requestCount++;

    if (data?.alerts?.length) {
      const newEvents = [];

      for (const alert of data.alerts) {
        const eventId = alert.uuid || `${alert.type}-${alert.lat}-${alert.lon}`;
        if (!collectedEvents.has(eventId)) {
          collectedEvents.set(eventId, true);
          newEvents.push(alert);
        }
      }

      if (newEvents.length > 0) {
        appendFileSync(
          config.outputFile,
          newEvents.map((e) => JSON.stringify(e)).join(",\n") + ",\n"
        );
        totalCollected += newEvents.length;
        console.log(
          `[${bounds.region}] ${newEvents.length} nuevos eventos (Total: ${totalCollected}/${config.targetEvents})`
        );
      }
    }

    // Ajuste dinámico del delay basado en la tasa de éxito
    const successRate =
      requestCount > 10
        ? (requestCount - requestCount * 0.1) / requestCount
        : 1;
    return Math.max(config.initialRequestDelay, 500 * successRate);
  } catch (error) {
    console.error(`Error en ${bounds.region}: ${error.message}`);
    return config.initialRequestDelay * 2;
  }
}

async function coordinateScanner() {
  while (totalCollected < config.targetEvents) {
    const currentScanner = regionScanners[currentRegionIndex];
    currentScanner.move();
    const bounds = currentScanner.getCurrentBounds();

    const nextDelay = await processArea(bounds);

    currentRegionIndex = (currentRegionIndex + 1) % regionScanners.length;

    // Delay dinámico
    await setTimeout(nextDelay);
  }

  finalize();
}

function finalize() {
  let data = readFileSync(config.outputFile, "utf8");
  if (data.endsWith(",\n")) data = data.slice(0, -2);
  if (!data.startsWith("[")) data = "[" + data;
  if (!data.endsWith("]")) data += "]";

  writeFileSync(config.outputFile, data);

  console.log(`
  ====================================
  ¡Recolección completada!
  Total eventos: ${totalCollected}
  Total peticiones: ${requestCount}
  Tasa de éxito: ${(totalCollected / requestCount).toFixed(2)} eventos/request
  ====================================
  `);
  process.exit();
}

// Inicialización
console.log(`
Iniciando recolección masiva de eventos...
Objetivo: ${config.targetEvents} eventos
Regiones: ${config.regions.map((r) => r.name).join(", ")}
`);

writeFileSync(config.outputFile, "");
process.on("SIGINT", finalize);

// Iniciar el escaneo
const parallelScanners = Array(config.maxParallelRequests)
  .fill()
  .map(() => coordinateScanner());
Promise.all(parallelScanners).catch(finalize);
