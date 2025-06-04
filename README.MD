# Plataforma de Análisis de Tráfico Waze - Proyecto de Sistemas Distribuidos

Proyecto para Sistemas Distribuidos 2025/1er-Semestre, que implementa una plataforma para la extracción, almacenamiento, caché y análisis simulado de eventos de tráfico de Waze en la Región Metropolitana.

**Integrantes:**

- Felipe Farfán Alvarado

## Descripción General

Este proyecto corresponde al Entregable 1: "Datos y Cache". El sistema se compone de varios módulos orquestados mediante Docker Compose para simular un flujo de datos desde la recolección hasta la consulta con un sistema de caché:

1.  **Scraper:** Extrae alertas de tráfico de Waze para la Región Metropolitana.
2.  **DB Loader:** Carga un conjunto de datos estático de eventos (`waze_10k_events.json`) en la base de datos MongoDB principal utilizada para los experimentos.
3.  **Cache:** Un servicio API (Node.js/Express) que actúa como caché usando Redis. Consulta primero Redis y, en caso de miss, consulta la base de datos MongoDB principal.
4.  **Traffic Generator:** Simula consultas de usuarios o sistemas hacia el servicio de Cache, utilizando diferentes patrones de acceso (Aleatorio, Sesgo de Recencia, Ponderado por Popularidad) y distribuciones de tasa de arribo (Constante, Poisson). Registra métricas de rendimiento de la caché.
5.  **Bases de Datos:** Se utilizan contenedores Docker para MongoDB (almacenamiento principal) y Redis (caché).

## Estructura del Proyecto

El repositorio está organizado en los siguientes directorios principales:

- `/scraper`: Código fuente, Dockerfile y configuración del módulo Scraper.
- `/db-loader`: Código fuente, Dockerfile y configuración del módulo DB Loader.
- `/traffic-generator`: Código fuente, Dockerfile, configuración y scripts `.js` de los diferentes generadores de tráfico.
- `/cache`: Código fuente, Dockerfile y configuración del módulo Cache API.
- `/data`: Contiene los datos estáticos iniciales (ej: `waze_10k_events.json`).
- `/scraped_data`: Directorio donde el scraper guarda los archivos JSON generados con timestamp.
- `/report`: Archivos fuente del informe LaTeX.
- `/scripts`: Scripts de automatización para ejecutar los experimentos (ej: `run_experiment_*.sh`, `run_experiment_*.ps1`).
- `/results`: Archivos CSV con los resultados de los experimentos.
- `docker-compose.yml`: Archivo principal para orquestar todos los servicios.

## Tecnologías Utilizadas

- Node.js (v18+)
- MongoDB
- Redis
- Docker & Docker Compose
- JavaScript (ES Modules)
- Bibliotecas Node.js: `mongodb`, `redis`, `express`, `node-fetch`, `dotenv`, etc.
- Shell scripting (Bash / PowerShell) para automatización de experimentos.

## Prerrequisitos

- **Docker:** Docker Engine o Docker Desktop instalado y corriendo. (Instrucciones: [https://docs.docker.com/get-docker/](https://docs.docker.com/get-docker/))
- **Docker Compose:** Generalmente viene incluido con Docker Desktop. Si no, seguir instrucciones de instalación. Se espera versión v2+.
- **Git:** Para clonar el repositorio.
- **(Solo Windows) Git Bash:** **Recomendado** para ejecutar los scripts de experimento `.sh`. Se puede descargar desde [https://git-scm.com/downloads](https://git-scm.com/downloads). Alternativamente, se pueden usar los scripts `.ps1` con PowerShell o ejecutar en WSL.

## Configuración

En general, el proyecto está diseñado para funcionar directamente con Docker Compose sin configuración manual adicional. Las variables de entorno necesarias para la comunicación entre contenedores (URLs de bases de datos, caché, etc.) están definidas dentro del archivo `docker-compose.yml`.

Si se desea modificar parámetros como el TTL de la caché, los puertos expuestos, o los parámetros por defecto de Redis, se puede editar el archivo `docker-compose.yml` o los archivos `.env` dentro de cada módulo _antes_ de construir/levantar los contenedores (aunque las variables del `docker-compose.yml` suelen tener prioridad).

## Instrucciones de Ejecución (Usando Docker Compose)

**IMPORTANTE:** Todos los comandos `docker-compose` deben ejecutarse desde la **raíz del proyecto** (la carpeta que contiene el archivo `docker-compose.yml`).

## Configuración y Ejecución

Sigue estos pasos desde la raíz del directorio del proyecto:

1.  **Clonar el Repositorio (si aplica):**

    ```bash
    git clone https://github.com/p163j02/Proyecto_SD
    cd Proyecto_SD
    ```

2.  **Iniciar Servicios Base:**
    Levanta MongoDB, Redis y el servicio de Cache API en segundo plano. Usa `--build` si es la primera vez que ejecutas o si has modificado el código de `cache`.

    ```bash
    docker-compose up -d --build mongo redis cache
    ```

    _(Opcional: Puedes incluir `scraper` aquí si quieres que se inicie automáticamente junto con los demás)_

    ```bash
    # docker-compose up -d --build mongo redis cache scraper
    ```

3.  **Cargar Datos Iniciales (para experimentos):**
    Ejecuta este comando **una sola vez** para poblar la base de datos `Waze.Events` con los datos del archivo `data/waze_10k_events.json`. Es necesario para que los experimentos de caché funcionen.

    ```bash
    docker-compose run --rm db-loader
    ```

    _Espera a que el proceso termine. Verás logs indicando el progreso y posiblemente errores de claves duplicadas (UUIDs), lo cual es normal y esperado si el índice único ya existe._

## Ejecutar Experimentos de Caché

Los scripts para ejecutar los experimentos se encuentran en la carpeta `scripts/`.

1.  **Navegar a la Carpeta de Scripts:**

    ```bash
    cd scripts
    ```

2.  **(Solo Linux/macOS/Git Bash) Dar Permisos de Ejecución:**
    Si es la primera vez, otorga permisos de ejecución al script `.sh`.

    ```bash
    chmod +x run_experiment.sh
    ```

3.  **Ejecutar el Experimento Deseado:**
    Este script ejecutará simulaciones variando la configuración de Redis (memoria, política de desalojo) para un patrón de acceso específico (Esta configurado inicialmente con el de "Ponderado por Popularidad"). El script que se ejecuta debe ser cambiado desde el archivo Dockerfile (Linea CMD) dentro de la carpeta `traffic-generator/`.

    - **Para ejecutar el script:**
      ```bash
      ./run_experiment.sh
      ```

    _(Nota: Si estás usando PowerShell en Windows y tienes scripts `.ps1` equivalentes, ejecuta `.\run_experiment_....ps1`)\_

    Los resultados se registrarán automáticamente en los archivos `.csv` correspondientes dentro del directorio `tarea_1_sd/results/` (o donde esté mapeado el volumen `results-data` en `docker-compose.yml`).

## Ejecutar el Scraper (Demo)

- **Iniciar el Scraper (si no se inició en el paso 2):**

  ```bash
  docker-compose up -d scraper
  ```

  _(Usa `--build` si modificaste su código)_

- **Verificar Datos:**
  Los datos recolectados se guardan en:

  - **Archivos JSON:** En el directorio `./scraped_data/` (mapeado por el volumen `scraped-data`).

- **Detener el Scraper:**
  ```bash
  docker-compose stop scraper
  ```

## Visualizar Logs

Puedes ver los logs de cualquier servicio en ejecución:

```bash
docker-compose logs -f <nombre_servicio>
docker-compose logs -f cache
docker-compose logs -f scraper
docker-compose logs -f db-loader
docker-compose logs -f traffic-generator # Solo muestra logs si se ejecutó con 'up', no con 'run'
```

# Módulo de Filtrado y Procesamiento de Datos de Tráfico (Tarea 2)

Este módulo es parte del proyecto "Plataforma de Análisis de Tráfico en Región Metropolitana" y se enfoca en el procesamiento distribuido de los datos de eventos de Waze recolectados y almacenados en MongoDB durante la Tarea 1. El objetivo es transformar estos datos crudos en información útil y agregada utilizando un pipeline que incluye pre-procesamiento con Node.js y procesamiento principal con Apache Pig sobre Hadoop.

## Estructura del Módulo de Filtrado y Procesamiento (Tarea 2)

El módulo de `filtrado_y_procesado`, integrado dentro del repositorio general del proyecto, está organizado de la siguiente manera:

- **`/filtrado_y_procesado/config/`**: Contiene los archivos de configuración XML para Hadoop (`core-site.xml`, `hdfs-site.xml`, `mapred-site.xml`, `yarn-site.xml`) utilizados por el entorno Docker para configurar los servicios HDFS y YARN.
- **`/filtrado_y_procesado/data/`**: Destinado a datos auxiliares necesarios para el procesamiento.
  - **`/filtrado_y_procesado/data/geo/`**: Almacena el archivo `comunas_rm.geojson`, que es utilizado por el script de pre-procesamiento para la asignación de comunas.
  - _(Este directorio `/filtrado_y_procesado/data/` también se utiliza temporalmente dentro del contenedor para almacenar el archivo JSON exportado de MongoDB (`waze_eventos_mongo.json`) y el CSV generado por el script de pre-procesamiento (`eventos_procesados_para_pig.csv`))_.
- **`/filtrado_y_procesado/graficos_50k_events/`**: Contiene los **datos procesados** y los **gráficos generados** correspondientes al dataset de 50.000 eventos Waze. Este directorio se utiliza para visualizar los resultados obtenidos tras ejecutar el pipeline completo de procesamiento y análisis. Puede incluir archivos `.csv`, y representaciones gráficas en formato `.png`.
- **`/filtrado_y_procesado/output_del_proyecto/`**: Directorio en la máquina host (mapeado desde `/output_on_host` dentro del contenedor) donde el `entrypoint.sh` copia los resultados finales generados por Apache Pig (los archivos CSV con las agregaciones). Este es el lugar donde el usuario encontrará las salidas del pipeline de procesamiento.
- **`/filtrado_y_procesado/scripts/`**: Contiene los scripts principales para el procesamiento de datos.
  - **`/filtrado_y_procesado/scripts/filtrador/`**: Módulo autocontenido de Node.js para el pre-procesamiento.
    - `preprocesar_eventos.js`: Script principal en Node.js que realiza la limpieza, asignación de comunas, filtrado regional y traducción de tipos/subtipos de los eventos Waze.
    - `package.json` y `package-lock.json`: Definen las dependencias Node.js para el script de pre-procesamiento.
    - `node_modules/`: (Directorio generado dentro del contenedor durante la construcción de la imagen Docker al ejecutar `npm install`).
  - `procesar_datos.pig`: El script de Apache Pig que define el flujo de procesamiento distribuido, incluyendo la carga de datos desde HDFS, transformaciones, deduplicación y las agregaciones principales.
  - `test_load.pig`: (Script de prueba para Apache Pig, si aplica).
- **`/filtrado_y_procesado/Dockerfile`**: Define el entorno Docker para el módulo de procesamiento, instalando Java, Hadoop, Pig (con Piggybank), Node.js, MongoDB Tools, y configurando el entorno necesario (incluyendo SSH sin contraseña) para la ejecución del pipeline.
- **`/filtrado_y_procesado/entrypoint.sh`**: Script principal que orquesta la ejecución completa del flujo de la Tarea 2 dentro del contenedor Docker: exportación desde MongoDB, pre-procesamiento con Node.js, inicio de servicios Hadoop, subida de datos a HDFS, ejecución del script Pig, y copia de los resultados finales al directorio montado del host.
- **`/filtrado_y_procesado/README.MD`**: (Opcional, si este contenido va en el README principal del proyecto) Describe específicamente este módulo de Tarea 2, sus componentes y cómo ejecutarlo.

**Integración con el Proyecto General (Tarea 1):**

- **`docker-compose.yml` (en la raíz del proyecto `Proyecto_SD/`)**: Este archivo, heredado y modificado de la Tarea 1, ahora incluye un nuevo servicio (ej. `processing_pipeline`) que construye y ejecuta el contenedor definido por `filtrado_y_procesado/Dockerfile`. Orquesta el inicio de este servicio en relación con el servicio `mongo` de la Tarea 1 y gestiona los volúmenes y redes necesarios.
- Los directorios de la Tarea 1 (`/scraper`, `/db-loader`, etc., según el `README.MD` de Tarea 1) permanecen en la raíz del proyecto y son responsables de la recolección y carga inicial de datos a MongoDB.

## Requisitos Previos

1.  **Docker y Docker Compose Instalados:** Necesarios para construir y ejecutar los servicios.
2.  **Datos en MongoDB (Tarea 1):** El servicio `mongo` definido en el `docker-compose.yml` principal (del directorio raíz de `Proyecto_SD`) debe estar en ejecución y la base de datos (`Waze`) y colección (`Events`) deben estar pobladas. Esto se logra ejecutando los componentes de la Tarea 1 (especialmente `db-loader/loader.js`).
3.  **Archivo `comunas_rm.geojson`:** Debe estar presente en `filtrado_y_procesado/data/geo/`. Este archivo es crucial para el script `preprocesar_eventos.js`.
4.  **(Opcional pero Recomendado) `piggybank.jar`:** El `Dockerfile` está configurado para descargar `piggybank.jar` y colocarlo en `/opt/pig/lib/`. Asegúrate de que la versión sea compatible con Pig 0.17.0.

## Configuración del Entorno

El `Dockerfile` en este directorio (`filtrado_y_procesado/`) se encarga de construir una imagen Docker con:

- Java OpenJDK 8
- Apache Hadoop 2.10.2
- Apache Pig 0.17.0 (con `piggybank.jar`)
- Node.js (v18.x para el script de pre-procesamiento)
- MongoDB Tools (para `mongoexport`)
- Configuración de SSH sin contraseña para el usuario `root` (necesario para los scripts de inicio de Hadoop).
- Los scripts de la aplicación (`preprocesar_eventos.js`, `procesar_datos.pig`, `entrypoint.sh`).

## Flujo de Procesamiento Automatizado

El flujo se orquesta principalmente a través del servicio `processing_pipeline` definido en el `docker-compose.yml` principal (ubicado en la raíz del proyecto `Proyecto_SD/`) y el script `entrypoint.sh` dentro del contenedor de este servicio.

1.  **Extracción de MongoDB:** `mongoexport` extrae datos de la colección de eventos de Waze.
2.  **Pre-procesamiento JS:** `preprocesar_eventos.js` limpia, filtra (por RM), asigna comunas y traduce los datos, generando un CSV.
3.  **Inicio de Hadoop:** Se inician los servicios HDFS y YARN. Se espera a que HDFS salga del modo seguro.
4.  **Carga a HDFS:** El CSV pre-procesado se sube a HDFS.
5.  **Procesamiento con Pig:** Se ejecuta el script `procesar_datos.pig` para realizar agregaciones y transformaciones.
6.  **Copia de Resultados:** Los resultados de Pig se copian desde HDFS al directorio local del host `filtrado_y_procesado/output_del_proyecto/`.

## Instrucciones de Ejecución

**Desde el directorio raíz del proyecto `Proyecto_SD/`:**

1.  **Clonar el Repositorio (si aplica):**

    ```bash
    git clone https://github.com/p163j02/Proyecto_SD
    cd Proyecto_SD
    ```

2.  **Asegurar que MongoDB de Tarea 1 esté corriendo y con datos:**

    ```bash
    # Si aún no está corriendo o necesitas reiniciar:
    docker-compose up -d mongo

    # Ejecutar el loader de Tarea 1:
    docker-compose run --rm db-loader
    ```

3.  **Construir y ejecutar el pipeline de procesamiento de Tarea 2:**

    ```bash
    # Para construir la imagen si hay cambios en filtrado_y_procesado/Dockerfile
    # o sus archivos copiados, y luego iniciar:
    docker-compose up --build -d processing_pipeline

    # Si la imagen ya está construida y solo quieres iniciar el servicio:
    # docker-compose up -d processing_pipeline
    ```

    _La opción `-d` ejecuta el contenedor en modo detached (segundo plano). Puedes omitirla para ver los logs directamente en la terminal._

4.  **Monitorear los Logs (si se ejecutó en modo detached):**

    ```bash
    docker logs -f tarea2_processing_pipeline
    ```

    Esto te mostrará el progreso a través de los pasos definidos en `filtrado_y_procesado/entrypoint.sh`.

5.  **Acceder a los Resultados:**
    Una vez que el script `entrypoint.sh` finalice, los resultados del procesamiento de Pig (archivos CSV) estarán disponibles en tu máquina local en la carpeta:
    `./filtrado_y_procesado/output_del_proyecto/`
    Dentro de esta, encontrarás subdirectorios como `conteo_eventos_por_comuna_tipo/`, `conteo_eventos_por_tipo_hora/`, etc., cada uno conteniendo los archivos `part-m-00000` con los datos.

## Repetir Carga de Datos con un Nuevo Conjunto de Eventos

Para realizar pruebas con diferentes volúmenes de datos o conjuntos de eventos distintos, es necesario primero limpiar la colección existente en MongoDB y luego ejecutar el `db-loader` apuntando al nuevo archivo JSON (o configurando `loader.js` para usar un archivo diferente).

**Pasos para Recargar Datos:**

1. **Asegurarse de eliminar el contenedor de tarea2_processing_pipeline:**
   Detener y eliminar contenedor antes de todo

```bash
docker container stop tarea2_processing_pipeline
docker container rm tarea2_processing_pipeline
```

2.  **Asegurar que MongoDB esté en ejecución:**
    Si el servicio MongoDB no está corriendo, inícialo:

```bash
# Desde el directorio raíz de Proyecto_SD/
docker-compose up -d mongo
```

3.  **Limpiar la Colección `Events` Existente en MongoDB:**
    Accede al shell de MongoDB dentro del contenedor `mongodb` y borra la colección.

```bash
# Desde tu PC, en una nueva terminal:
docker-compose exec mongo mongosh
```

Una vez dentro del shell de `mongosh`:

```javascript
use Waze;         // Cambia a la base de datos 'Waze'.
db.Events.drop(); // Borra la colección 'Events'.
exit;             // Sale del shell
```

Esto asegurará que la próxima carga se realice sobre una colección vacía.

4.  **Seleccionar el Nuevo Archivo JSON de Entrada para `db-loader`:**
5.  - **Modifica `db-loader/loader.js`** (si aún no lo has hecho) para leer un nuevo archivo de datos .json, solo hace falta cambiar el archivo que leé `filePath` en la linea 25 (cuyo valor podría ser `waze_10k_events`, `waze_50k_events`, `waze_100k_events`)

- Asegúrate de que los archivos JSON correspondientes (ej. `waze_10k_events.json`, `waze_50k_events.json`) existan en el directorio `./data/` de tu proyecto en la máquina host, ya que este directorio se monta en `/usr/src/app/data/` dentro del contenedor `db-loader` según la configuración de Tarea 1.

6.  **Reconstruir la imagen**

```bash
docker-compose build db-loader
```

7.  **Ejecutar `db-loader` para Cargar los Nuevos Datos:**
    Ejecuta el servicio `db-loader`

```bash
 docker-compose run --rm db-loader
```

Después de estos pasos, tu base de datos MongoDB estará poblada con el nuevo conjunto de datos, y podrás proceder a ejecutar el pipeline de `processing_pipeline` para analizar esta nueva carga:

```bash
docker-compose up --build processing_pipeline
# O sin --build si la imagen no ha cambiado y solo quieres re-ejecutar el flujo.
```

## Scripts Principales

- **`filtrado_y_procesado/scripts/filtrador/preprocesar_eventos.js`**:

  - Encargado de la limpieza inicial, asignación de comunas, filtrado por Región Metropolitana y traducción de tipos/subtipos de eventos.
  - Lee un archivo JSON exportado de MongoDB y genera un archivo CSV.
  - Utiliza `filtrado_y_procesado/data/geo/comunas_rm.geojson` para la lógica de comunas.
  - Sus dependencias Node.js están definidas en `filtrado_y_procesado/scripts/filtrador/package.json`.

- **`filtrado_y_procesado/scripts/procesar_datos.pig`**:

  - Script de Apache Pig que define el flujo de procesamiento distribuido.
  - Carga el CSV pre-procesado desde HDFS.
  - Realiza la deduplicación de UUIDs.
  - Transforma timestamps y extrae componentes de fecha/hora.
  - Calcula diversas agregaciones (conteos, promedios, top N) para análisis de tendencias.
  - Guarda los resultados en HDFS.

- **`filtrado_y_procesado/entrypoint.sh`**:
  - Script principal que se ejecuta al iniciar el contenedor `processing_pipeline`.
  - Orquesta todos los pasos: `mongoexport`, ejecución del script JS, inicio de Hadoop, carga a HDFS, ejecución de Pig y copia de resultados.

## Configuración de Hadoop

Los archivos de configuración de Hadoop (`core-site.xml`, `hdfs-site.xml`, `mapred-site.xml`, `yarn-site.xml`) se encuentran en la carpeta `filtrado_y_procesado/config/` y son copiados al contenedor durante la construcción de la imagen. Están configurados para un modo pseudo-distribuido.
