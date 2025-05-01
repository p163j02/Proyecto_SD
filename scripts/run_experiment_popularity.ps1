<#
.SYNOPSIS
Script para ejecutar experimentos de caché para un patrón de acceso específico,
orquestando servicios base (mongo, cache) y reconfigurando Redis vía Docker Compose.

.DESCRIPTION
1. Asegúrate que los servicios 'mongo' y 'cache' estén corriendo (ejecuta 'docker-compose up -d mongo cache' desde la raíz).
2. Ejecuta este script desde la carpeta /scripts/ (ej: .\run_experiment_popularity.ps1).
3. El script iterará por políticas y memorias, reconfigurando y reiniciando el servicio 'redis'
   y ejecutando el servicio 'traffic-generator' para cada combinación usando docker-compose.
4. Los resultados se añaden al archivo CSV especificado dentro del script del generador.

.NOTES
Requiere Docker y Docker Compose v2 instalados.
El archivo docker-compose.yml debe estar configurado para usar $env:REDIS_POLICY_VAR y $env:REDIS_MAXMEMORY_VAR
en la definición del comando del servicio 'redis'.
El servicio 'traffic-generator' debe estar definido para usar las variables pasadas con -e
y montar un volumen para guardar el CSV (ej: ./results:/usr/src/app/results).
#>

param() # Necesario para que $MyInvocation funcione correctamente

Write-Host "Iniciando script de experimentos de caché (PowerShell)..."

# --- Configuración del Experimento ---
$policies = @("allkeys-random", "allkeys-lru") # O las que quieras probar
$memories = @("10mb", "25mb", "100mb")       # O las que quieras probar

# Nombre EXACTO del script generador para ESTE patrón de acceso
$generatorScriptName = "generator_popularity_weighted.js" # <-- AJUSTA ESTE NOMBRE SI ES DIFERENTE
$generatorServiceDir = "..\traffic-generator" # Ruta relativa desde /scripts
$generatorServiceName = "traffic-generator" # Nombre del servicio en docker-compose.yml
$redisServiceName = "redis"             # Nombre del servicio redis en docker-compose.yml

# Nombre esperado del archivo CSV (para mensaje final)
# Asegúrate que coincida con lo definido en el script $generatorScriptName
$expectedCsvFile = "simulation_results_popularity.csv" # <-- AJUSTA SI ES DIFERENTE
$resultsDirInHost = "..\results" # Asume que el CSV se guarda en /results en el host
# -----------------------------------

# Obtener la ruta raíz del proyecto (asumiendo que scripts está un nivel abajo)
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Write-Host "Raíz del proyecto detectada: $projectRoot"

# Bucle principal
foreach ($policy in $policies) {
    foreach ($memory in $memories) {
        Write-Host "-----------------------------------------------------" -ForegroundColor Yellow
        Write-Host "Probando: Policy=$policy, MaxMemory=$memory, Patrón=PopularityWeighted" -ForegroundColor Yellow # Ajusta el nombre del patrón
        Write-Host "-----------------------------------------------------" -ForegroundColor Yellow

        # 1. Define variables para que Docker Compose las lea al levantar Redis
        Write-Host "Estableciendo variables de entorno para Docker Compose (Redis)..."
        $env:REDIS_POLICY_VAR = $policy
        $env:REDIS_MAXMEMORY_VAR = $memory

        # 2. Detiene y reinicia el servicio Redis con la nueva configuración
        Write-Host "Reconfigurando Redis (Policy=$policy, Memory=$memory)..."
        # Ejecutar docker-compose desde la raíz del proyecto
        Push-Location $projectRoot # Cambia temporalmente a la raíz
        docker-compose stop $redisServiceName | Out-Null # Detiene el servicio si corre
        docker-compose rm -fsv $redisServiceName | Out-Null # Elimina el contenedor antiguo
        docker-compose up -d $redisServiceName # Levanta redis (leerá las variables $env:...)
        $redisExitCode = $LASTEXITCODE
        Pop-Location # Vuelve al directorio original (/scripts)

        if ($redisExitCode -ne 0) {
            Write-Error "¡Error al iniciar Redis con la nueva configuración!"
            # Decide si detener el script
            # exit 1
            continue # Salta a la siguiente iteración
        }

        Write-Host "Esperando que Redis reinicie..."
        Start-Sleep -Seconds 7 # Pausa un poco más larga por si acaso

        # 3. Ejecuta el generador pasando las variables para que las registre en el CSV
        Write-Host "Ejecutando $generatorServiceName ..."
        # Ejecutar docker-compose run desde la raíz del proyecto
        Push-Location $projectRoot # Cambia temporalmente a la raíz
        # Pasa las variables con -e para que el script Node las use para el CSV
        docker-compose run --rm `
            -e REDIS_POLICY="$policy" `
            -e REDIS_MAXMEMORY="$memory" `
            $generatorServiceName # Nombre del servicio en docker-compose.yml
        $generatorExitCode = $LASTEXITCODE
        Pop-Location # Vuelve al directorio original (/scripts)

        if ($generatorExitCode -ne 0) {
            Write-Warning "¡Error durante la ejecución de ${generatorServiceName} (Código: ${generatorExitCode})!"
            # No necesariamente detener todo el script por un fallo del generador
        }

        # 4. Limpiar variables de entorno (buena práctica)
        Remove-Item Env:\REDIS_POLICY_VAR -ErrorAction SilentlyContinue
        Remove-Item Env:\REDIS_MAXMEMORY_VAR -ErrorAction SilentlyContinue

        Write-Host "Prueba completada para Policy=${policy}, MaxMemory=${memory}"
        Write-Host ""
    }
}

Write-Host "Script de experimentos finalizado." -ForegroundColor Green
# Construir ruta al archivo de resultados esperado
$resultsFullPath = Join-Path $projectRoot (Join-Path $resultsDirInHost $expectedCsvFile)
Write-Host "Revisa el archivo $resultsFullPath" -ForegroundColor Green

# Opcional: Detener los servicios base al final
# Write-Host "Deteniendo servicios base (mongo, cache, redis)..."
# Push-Location $projectRoot
# docker-compose down
# Pop-Location