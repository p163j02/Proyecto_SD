# Plataforma de Análisis de Tráfico Waze - Tarea 1 SD

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
    git clone [https://github.com/tu_usuario/tu_repositorio](https://github.com/tu_usuario/tu_repositorio) # Reemplaza con tu URL real
    cd tu_repositorio
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
