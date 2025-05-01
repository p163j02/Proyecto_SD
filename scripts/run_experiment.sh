#!/bin/bash
echo "Iniciando script de experimentos de caché..."
policies=("allkeys-random" "allkeys-lru") 
memories=("10mb" "25mb" "100mb")     
generator_service_name="traffic-generator" # Nombre del servicio en compose
redis_service_name="redis"             # Nombre del servicio redis en compose


for policy in "${policies[@]}"; do
  for memory in "${memories[@]}"; do
    echo "-----------------------------------------------------"
    echo "Probando: Policy=${policy}, MaxMemory=${memory}"
    echo "-----------------------------------------------------"

    # 1. Define variables para Compose (serán leídas por el servicio redis al iniciar)
    export REDIS_POLICY_VAR="$policy"
    export REDIS_MAXMEMORY_VAR="$memory"

    # 2. Detiene y reinicia el servicio Redis con la nueva configuración
    echo "Reconfigurando Redis (Policy=${policy}, Memory=${memory})..."
    docker-compose stop ${redis_service_name} > /dev/null 2>&1 # Detiene el servicio si corre
    docker-compose rm -fsv ${redis_service_name} > /dev/null 2>&1 # Elimina el contenedor antiguo
    docker-compose up -d ${redis_service_name} # Levanta redis (leerá las variables exportadas)

    echo "Esperando que Redis reinicie..."
    sleep 5 # Pausa simple (puede necesitar ajuste o un chequeo real)

    # 3. Ejecuta el generador pasando las variables para que las registre en el CSV
    echo "Ejecutando ${generator_service_name}..."
    docker-compose run --rm \
      -e REDIS_POLICY="$policy" \
      -e REDIS_MAXMEMORY="$memory" \
      ${generator_service_name}

    exit_code=$?
    if [ $exit_code -ne 0 ]; then
      echo "¡Error durante la ejecución de ${generator_service_name} (Código: ${exit_code})!"
    fi

    # 4. Limpiar variables (opcional pero buena práctica)
    unset REDIS_POLICY_VAR
    unset REDIS_MAXMEMORY_VAR

    echo "Prueba completada para Policy=${policy}, MaxMemory=${memory}"
    echo ""
  done
done

echo "Script de experimentos finalizado."
echo "Revisa el archivo ${generator_script_dir}/${expected_csv_file}"
