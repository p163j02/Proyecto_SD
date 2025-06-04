#!/bin/bash
set -e 

echo "--- Iniciando Flujo Automatizado Tarea 2 con Medición de Tiempo ---"

# Función para obtener el tiempo actual en milisegundos
current_time_ms() {
  echo $(($(date +%s%N)/1000000))
}

# Variables de entorno
HADOOP_USER_NAME=${HADOOP_USER_NAME:-root}
MONGO_HOST_PARAM=${MONGO_HOST:-mongodb}
MONGO_DB_NAME_PARAM=${MONGO_DB_NAME:-waze_data}
MONGO_COLLECTION_PARAM=${MONGO_COLLECTION:-events}

# Rutas dentro del contenedor
APP_SCRIPTS_DIR="/app/scripts"
JS_SCRIPT_PATH="/app/scripts/filtrador/preprocesar_eventos.js"
GEOJSON_PATH="/app/data/geo/comunas_rm.geojson"
PIG_SCRIPT_PATH="/app/scripts/procesar_datos.pig"

JS_INPUT_DATA_DIR="/app/data"
MONGO_EXPORT_FILE="$JS_INPUT_DATA_DIR/waze_eventos_mongo.json"
PREPROCESSED_CSV_FILE="$JS_INPUT_DATA_DIR/eventos_procesados_para_pig.csv"

HDFS_USER_HOME_DIR="/user/${HADOOP_USER_NAME}"
HDFS_INPUT_DIR="${HDFS_USER_HOME_DIR}/input_data"
HDFS_INPUT_FILE_PATH="${HDFS_INPUT_DIR}/eventos_procesados_para_pig.csv"
HDFS_PIG_OUTPUT_PATH_PREFIX="${HDFS_USER_HOME_DIR}/output"

LOCAL_RESULTS_DIR_IN_CONTAINER="/app/pig_results_export"
HOST_MOUNTED_OUTPUT_DIR="/output_on_host"

# Crear directorios locales en el contenedor
mkdir -p $JS_INPUT_DATA_DIR
mkdir -p $LOCAL_RESULTS_DIR_IN_CONTAINER

# Marcas de tiempo para medición
TOTAL_START_TIME=$(current_time_ms)
TIME_MONGO_EXPORT_START=0
TIME_MONGO_EXPORT_END=0
TIME_JS_PREPROC_START=0
TIME_JS_PREPROC_END=0
TIME_HADOOP_INIT_START=0
TIME_HADOOP_INIT_END=0
TIME_HDFS_PUT_START=0
TIME_HDFS_PUT_END=0
TIME_PIG_EXEC_START=0
TIME_PIG_EXEC_END=0
TIME_HDFS_GET_START=0
TIME_HDFS_GET_END=0

# --- PASO 1: Exportar datos de MongoDB ---
echo "[PASO 1/7] Exportando datos de MongoDB ($MONGO_HOST_PARAM)..."
TIME_MONGO_EXPORT_START=$(current_time_ms)
if mongoexport --host $MONGO_HOST_PARAM --port 27017 --db $MONGO_DB_NAME_PARAM \
               --collection $MONGO_COLLECTION_PARAM --out $MONGO_EXPORT_FILE --jsonArray --quiet; then
    TIME_MONGO_EXPORT_END=$(current_time_ms)
    echo "Datos exportados correctamente a $MONGO_EXPORT_FILE"
else
    TIME_MONGO_EXPORT_END=$(current_time_ms)
    echo "ADVERTENCIA: Fallo al exportar datos de MongoDB."
    if [ -f "$MONGO_EXPORT_FILE" ] && [ -s "$MONGO_EXPORT_FILE" ]; then
        echo "Se utilizará el archivo $MONGO_EXPORT_FILE preexistente."
    else
        echo "ERROR CRÍTICO: El archivo $MONGO_EXPORT_FILE no existe o está vacío y la exportación falló."
        exit 1
    fi
fi

# --- PASO 2: Ejecutar script de pre-procesamiento JavaScript ---
echo "[PASO 2/7] Ejecutando script de pre-procesamiento JavaScript..."
TIME_JS_PREPROC_START=$(current_time_ms)
if node "$JS_SCRIPT_PATH" "$MONGO_EXPORT_FILE" "$GEOJSON_PATH" "$PREPROCESSED_CSV_FILE"; then
    TIME_JS_PREPROC_END=$(current_time_ms)
    echo "Script JS completado. CSV generado en $PREPROCESSED_CSV_FILE"
    if [ -f "$PREPROCESSED_CSV_FILE" ]; then
        NUM_LINES_IN_CSV=$(wc -l < "$PREPROCESSED_CSV_FILE")
        NUM_DATA_RECORDS_FOR_PIG=$((NUM_LINES_IN_CSV - 1)) 

        echo "-------------------------------------------------------------------"
        echo "VERIFICACIÓN DE DATOS PARA PIG:"
        echo "Archivo CSV generado por JS: $PREPROCESSED_CSV_FILE"
        echo "Número total de líneas en el CSV (incluyendo encabezado): $NUM_LINES_IN_CSV"
        echo "Número de registros de datos a procesar por Pig (aprox.): $NUM_DATA_RECORDS_FOR_PIG"
        echo "-------------------------------------------------------------------"
    else
        echo "ADVERTENCIA: No se encontró el archivo CSV $PREPROCESSED_CSV_FILE para contar líneas."
    fi
else
    TIME_JS_PREPROC_END=$(current_time_ms)
    echo "ERROR CRÍTICO: Falló el script de pre-procesamiento JavaScript."
    exit 1
fi

# --- PASO 3: Formatear HDFS (condicional) e Iniciar SSH ---
echo "[PASO 3/7] Configurando HDFS y SSH..."
TIME_HADOOP_INIT_START=$(current_time_ms)
NAMENODE_DIR="$HADOOP_DATA_DIR/hdfs/namenode"
if [ ! -d "$NAMENODE_DIR/current" ]; then
  echo "Formateando HDFS Namenode..."
  mkdir -p /opt/hadoop/hadoop_tmp_data
  $HADOOP_HOME/bin/hdfs namenode -format -force -nonInteractive
fi

echo "Iniciando servicio SSH..."
service ssh start

# --- PASO 4: Iniciar demonios Hadoop y crear directorios HDFS base ---
echo "[PASO 4/7] Iniciando HDFS (NameNode y DataNode)..."
$HADOOP_HOME/sbin/start-dfs.sh
echo "HDFS supuestamente iniciado. Creando directorios HDFS base necesarios..."
sleep 5 
$HADOOP_HOME/bin/hdfs dfs -mkdir -p /tmp
$HADOOP_HOME/bin/hdfs dfs -chmod 1777 /tmp
$HADOOP_HOME/bin/hdfs dfs -mkdir -p /user
$HADOOP_HOME/bin/hdfs dfs -mkdir -p $HDFS_USER_HOME_DIR

echo "Iniciando YARN (ResourceManager y NodeManager)..."
$HADOOP_HOME/sbin/start-yarn.sh

echo "Iniciando MapReduce JobHistory Server..."
$HADOOP_HOME/sbin/mr-jobhistory-daemon.sh start historyserver
TIME_HADOOP_INIT_END=$(current_time_ms) 
echo "Servicios de Hadoop y YARN iniciados."
jps

# --- PASO 5: Esperar a que HDFS salga del modo seguro ---
echo "[PASO 5/7] Esperando a que HDFS salga del modo seguro..."
TIMEOUT=120
while $HADOOP_HOME/bin/hdfs dfsadmin -safemode get | grep -q "Safe mode is ON"; do
  if [ $TIMEOUT -le 0 ]; then
    echo "ERROR CRÍTICO: HDFS no salió del modo seguro después de $TIMEOUT segundos."
    exit 1
  fi
  echo "HDFS está en modo seguro, esperando 5 segundos más..."
  sleep 5
  TIMEOUT=$((TIMEOUT-5))
done
echo "HDFS está listo (Modo Seguro OFF)."

# --- PASO 6: Preparar datos en HDFS para Pig y ejecutar Pig ---
echo "[PASO 6/7] Preparando datos para Pig y ejecutando script..."
TIME_HDFS_PUT_START=$(current_time_ms)
$HADOOP_HOME/bin/hdfs dfs -mkdir -p $(dirname $HDFS_INPUT_FILE_PATH)
echo "Copiando $PREPROCESSED_CSV_FILE a $HDFS_INPUT_FILE_PATH en HDFS..."
if $HADOOP_HOME/bin/hdfs dfs -put -f "$PREPROCESSED_CSV_FILE" "$HDFS_INPUT_FILE_PATH"; then
    TIME_HDFS_PUT_END=$(current_time_ms)
    echo "Archivo subido a HDFS."
else
    TIME_HDFS_PUT_END=$(current_time_ms)
    echo "ERROR CRÍTICO: Falló el comando hdfs dfs -put."
    exit 1
fi

echo "Limpiando directorio de salida previo de Pig en HDFS: $HDFS_PIG_OUTPUT_PATH_PREFIX"
$HADOOP_HOME/bin/hdfs dfs -rm -r -f $HDFS_PIG_OUTPUT_PATH_PREFIX

echo "Ejecutando script de Pig: $PIG_SCRIPT_PATH"
TIME_PIG_EXEC_START=$(current_time_ms)
if pig -x mapreduce "$PIG_SCRIPT_PATH"; then
  TIME_PIG_EXEC_END=$(current_time_ms)
  echo "Script de Pig ejecutado exitosamente."
else
  TIME_PIG_EXEC_END=$(current_time_ms)
  echo "ERROR CRÍTICO: El script de Pig falló."
  exit 1
fi

# --- PASO 7: Copiar resultados de Pig desde HDFS al directorio montado ---
echo "[PASO 7/7] Copiando resultados de Pig desde HDFS ($HDFS_PIG_OUTPUT_PATH_PREFIX) a ($HOST_MOUNTED_OUTPUT_DIR)..."
TIME_HDFS_GET_START=$(current_time_ms)
if $HADOOP_HOME/bin/hdfs dfs -test -d $HDFS_PIG_OUTPUT_PATH_PREFIX; then
  mkdir -p $LOCAL_RESULTS_DIR_IN_CONTAINER 
  $HADOOP_HOME/bin/hdfs dfs -get "$HDFS_PIG_OUTPUT_PATH_PREFIX"/* "$LOCAL_RESULTS_DIR_IN_CONTAINER"/
  
  if [ -d "$HOST_MOUNTED_OUTPUT_DIR" ]; then
    cp -R $LOCAL_RESULTS_DIR_IN_CONTAINER/* $HOST_MOUNTED_OUTPUT_DIR/
    echo "Resultados de Pig copiados a $HOST_MOUNTED_OUTPUT_DIR en tu PC."
  else
    echo "ADVERTENCIA: El directorio montado $HOST_MOUNTED_OUTPUT_DIR no fue encontrado. Resultados en $LOCAL_RESULTS_DIR_IN_CONTAINER dentro del contenedor."
  fi
else
  echo "ADVERTENCIA: El directorio de salida de Pig $HDFS_PIG_OUTPUT_PATH_PREFIX no se encontró en HDFS."
fi
TIME_HDFS_GET_END=$(current_time_ms)

TOTAL_END_TIME=$(current_time_ms)

echo "-------------------------------------------------------------------"
echo "--- RESUMEN DE TIEMPOS (milisegundos) ---"
echo "Tiempo Exportación MongoDB: $((TIME_MONGO_EXPORT_END - TIME_MONGO_EXPORT_START)) ms"
echo "Tiempo Pre-procesamiento JS: $((TIME_JS_PREPROC_END - TIME_JS_PREPROC_START)) ms"
echo "Tiempo Inicialización Hadoop (formato, ssh, start daemons): $((TIME_HADOOP_INIT_END - TIME_HADOOP_INIT_START)) ms"
echo "Tiempo Carga CSV a HDFS (-put): $((TIME_HDFS_PUT_END - TIME_HDFS_PUT_START)) ms"
echo "Tiempo Ejecución Script Pig: $((TIME_PIG_EXEC_END - TIME_PIG_EXEC_START)) ms"
echo "Tiempo Copia Resultados de HDFS a Host (-get y cp): $((TIME_HDFS_GET_END - TIME_HDFS_GET_START)) ms"
echo "-------------------------------------------------------------------"
echo "TIEMPO TOTAL DEL FLUJO: $((TOTAL_END_TIME - TOTAL_START_TIME)) ms"
echo "-------------------------------------------------------------------"

echo "--- Flujo de Filtrado y Procesamiento Tarea 2 FINALIZADO ---"
