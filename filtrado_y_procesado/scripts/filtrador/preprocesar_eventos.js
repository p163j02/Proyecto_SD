import { readFileSync, writeFileSync } from "fs";
import { point as _point, booleanPointInPolygon } from "@turf/turf";

const RUTA_EVENTOS_JSON = process.argv[2];
const RUTA_COMUNAS_GEOJSON = process.argv[3];
const RUTA_SALIDA_CSV = process.argv[4];

const COMUNAS_RM = [
  "Alhué",
  "Buin",
  "Calera de Tango",
  "Cerrillos",
  "Cerro Navia",
  "Colina",
  "Conchalí",
  "Curacaví",
  "El Bosque",
  "El Monte",
  "Estación Central",
  "Huechuraba",
  "Independencia",
  "Isla de Maipo",
  "La Cisterna",
  "La Florida",
  "La Granja",
  "La Pintana",
  "La Reina",
  "Lampa",
  "Las Condes",
  "Lo Barnechea",
  "Lo Espejo",
  "Lo Prado",
  "Macul",
  "Maipú",
  "María Pinto",
  "Melipilla",
  "Ñuñoa",
  "Padre Hurtado",
  "Paine",
  "Pedro Aguirre Cerda",
  "Peñaflor",
  "Peñalolén",
  "Pirque",
  "Providencia",
  "Pudahuel",
  "Puente Alto",
  "Quilicura",
  "Quinta Normal",
  "Recoleta",
  "Renca",
  "San Bernardo",
  "San Joaquín",
  "San José de Maipo",
  "San Miguel",
  "San Pedro",
  "San Ramón",
  "Santiago",
  "Talagante",
  "Tiltil",
  "Vitacura",
].map((c) => c.toLowerCase());

const TRADUCCIONES_TIPO = {
  ACCIDENT: "ACCIDENTE",
  JAM: "CONGESTION",
  WEATHERHAZARD: "PELIGRO_CLIMATICO",
  ROAD_CLOSED: "CALLE_CERRADA",
  HAZARD: "PELIGRO_GENERAL",
  CHIT_CHAT: "CONVERSACION",
  POLICE: "POLICIA",
};

const TRADUCCIONES_SUBTIPO = {
  // Accidentes
  ACCIDENT_MINOR: "ACCIDENTE_MENOR",
  ACCIDENT_MAJOR: "ACCIDENTE_MAYOR",
  NO_SUBTYPE: "SIN_SUBTIPO",
  // Congestión
  JAM_HEAVY_TRAFFIC: "CONGESTION_ALTA",
  JAM_STAND_STILL_TRAFFIC: "CONGESTION_DETENIDA",
  JAM_LIGHT_TRAFFIC: "CONGESTION_LIGERA",
  JAM_MODERATE_TRAFFIC: "CONGESTION_MODERADA",
  // Peligros
  HAZARD_ON_ROAD: "PELIGRO_EN_CALZADA",
  HAZARD_ON_SHOULDER: "PELIGRO_EN_BERMA",
  HAZARD_WEATHER: "PELIGRO_CLIMATICO_GENERICO",
  HAZARD_FLOOD: "INUNDACION",
  HAZARD_OBJECT_ON_ROAD: "OBJETO_EN_CALZADA",
  HAZARD_POT_HOLE: "BACHE",
  HAZARD_ROAD_KILL: "ANIMAL_EN_CALZADA",
  HAZARD_ON_ROAD_POT_HOLE: "BACHE_EN_CALZADA",
  HAZARD_ON_ROAD_CONSTRUCTION: "CONSTRUCCION_EN_CALZADA",
  HAZARD_ON_ROAD_TRAFFIC_LIGHT_FAULT: "SEMAFORO_DESCOMPUESTO",
  HAZARD_ON_SHOULDER_CAR_STOPPED: "VEHICULO_DETENIDO_EN_BERMA",
  // Cierre de calle
  ROAD_CLOSED_EVENT: "CALLE_CERRADA_EVENTO",
  ROAD_CLOSED_CONSTRUCTION: "CALLE_CERRADA_CONSTRUCCION",
  ROAD_CLOSED_HAZARD: "CALLE_CERRADA_PELIGRO",
  // Policia
  POLICE_HIDING: "POLICIA_ESCONDIDO",
  POLICE_WITH_MOBILE_CAMERA: "POLICIA_CON_CAMARA_MOVIL",
};

/**
 * @param {object} location
 * @param {object} comunasGeoJson
 * @returns {string|null}
 */
function determinarComuna(location, comunasGeoJson) {
  if (
    !location ||
    typeof location.y !== "number" ||
    typeof location.x !== "number"
  ) {
    return null;
  }
  const point = _point([location.x, location.y]);
  for (const feature of comunasGeoJson.features) {
    const communeNameProperty = "NOMBRE_COMUNA";
    if (
      feature.geometry &&
      feature.properties &&
      feature.properties[communeNameProperty]
    ) {
      if (booleanPointInPolygon(point, feature.geometry)) {
        return feature.properties[communeNameProperty];
      }
    }
  }
  return null;
}

/**
 * @param {Array<object>} data
 * @param {Array<string>} headers
 * @returns {string}
 */
function convertirAClase(data, headers) {
  const csvRows = [];
  csvRows.push(headers.join(","));

  for (const row of data) {
    const values = headers.map((header) => {
      let value = row[header];
      if (value === null || value === undefined) {
        value = "";
      } else if (typeof value === "string" && value.includes(",")) {
        value = `"${value}"`;
      }
      return value;
    });
    csvRows.push(values.join(","));
  }
  return csvRows.join("\n");
}

try {
  // 1. Carga datos
  const rawEventsData = readFileSync(RUTA_EVENTOS_JSON, "utf-8");
  const wazeEvents = JSON.parse(rawEventsData);

  const comunasGeoJsonData = readFileSync(RUTA_COMUNAS_GEOJSON, "utf-8");
  const comunasGeoJson = JSON.parse(comunasGeoJsonData);

  const eventosProcesados = [];

  for (const event of wazeEvents) {
    let comunaAsignada = event.city ? event.city.trim() : null;

    // 2. Asigna comuna si falta, usando coordenadas
    if (!comunaAsignada && event.location) {
      const comunaDeterminada = determinarComuna(
        event.location,
        comunasGeoJson
      );
      if (comunaDeterminada) {
        comunaAsignada = comunaDeterminada.trim();
      }
    }

    if (!comunaAsignada) {
      continue;
    }

    const comunaNormalizada = comunaAsignada.toLowerCase();

    // 3. Filtra por Región Metropolitana
    if (!COMUNAS_RM.includes(comunaNormalizada)) {
      continue;
    }

    // 4. Traduce tipo y subtipo
    const tipoTraducido = TRADUCCIONES_TIPO[event.type] || event.type;
    let subtipoTraducido = event.subtype
      ? TRADUCCIONES_SUBTIPO[event.subtype] || event.subtype
      : TRADUCCIONES_SUBTIPO["NO_SUBTYPE"];

    const eventoParaCsv = {
      uuid: event.uuid,
      timestamp_ms: event.pubMillis,
      tipo_es: tipoTraducido,
      subtipo_es: subtipoTraducido,
      latitud: event.location ? event.location.y : null,
      longitud: event.location ? event.location.x : null,
      comuna: comunaAsignada,
      calle: event.street,
      n_likes: event.nThumbsUp,
      fiabilidad: event.reliability,
      rating_evento: event.reportRating,
    };

    if (eventoParaCsv.latitud === null || eventoParaCsv.longitud === null) {
      continue;
    }

    eventosProcesados.push(eventoParaCsv);
  }

  console.log(`Total de eventos originales: ${wazeEvents.length}`);
  console.log(
    `Total de eventos procesados y filtrados para RM: ${eventosProcesados.length}`
  );

  // 5. Exporta a CSV
  if (eventosProcesados.length > 0) {
    const headers = Object.keys(eventosProcesados[0]);
    const csvData = convertirAClase(eventosProcesados, headers);
    writeFileSync(RUTA_SALIDA_CSV, csvData, "utf-8");
    console.log(`Archivo CSV exportado correctamente a: ${RUTA_SALIDA_CSV}`);
  } else {
    console.log("No hay eventos procesados para exportar.");
  }
} catch (error) {
  console.error("Ocurrió un error durante el pre-procesamiento:", error);
}
