SET job.name 'Procesamiento Eventos Waze Tarea 2 - SD';

REGISTER /opt/pig/lib/piggybank.jar; 



events_loaded_and_typed = LOAD '/user/root/input_data/eventos_procesados_para_pig.csv'  
    USING org.apache.pig.piggybank.storage.CSVExcelStorage(
        ',',                
        'NO_MULTILINE',      
        'UNIX',
        'SKIP_INPUT_HEADER' 
    )   AS (
        uuid:chararray,          
        timestamp_ms:long,       
        tipo_es:chararray,
        subtipo_es:chararray,
        latitud:double,          
        longitud:double,         
        comuna:chararray,
        calle:chararray,
        n_likes:long,            
        fiabilidad:int,          
        rating_evento:int        
    );



events_cleaned = FILTER events_loaded_and_typed  
    BY timestamp_ms IS NOT NULL 
    AND latitud IS NOT NULL 
    AND longitud IS NOT NULL
    AND fiabilidad IS NOT NULL
    AND rating_evento IS NOT NULL;

DESCRIBE events_cleaned;


grouped_by_uuid = GROUP events_cleaned BY uuid; 
processed_events = FOREACH grouped_by_uuid GENERATE FLATTEN(TOP(1, 0, events_cleaned));

events_with_time = FOREACH processed_events GENERATE
    *,                                           
    ToDate(timestamp_ms) AS event_datetime,      
    GetHour(ToDate(timestamp_ms)) AS hora_dia,   
    GetDay(ToDate(timestamp_ms)) AS dia_mes,     
    GetMonth(ToDate(timestamp_ms)) AS mes,       
    GetYear(ToDate(timestamp_ms)) AS anio,       
    ToString(ToDate(timestamp_ms), 'EEEE') AS dia_semana;



-- A1: Conteo de eventos por comuna y tipo de evento
grouped_comuna_tipo = GROUP events_with_time BY (comuna, tipo_es);
conteo_comuna_tipo = FOREACH grouped_comuna_tipo GENERATE
    FLATTEN(group) AS (comuna, tipo_es),  
    COUNT(events_with_time) AS total_eventos;

-- A2: Conteo de eventos por tipo de evento y hora del día
grouped_tipo_hora = GROUP events_with_time BY (tipo_es, hora_dia);
conteo_tipo_hora = FOREACH grouped_tipo_hora GENERATE
    FLATTEN(group) AS (tipo_es, hora_dia),
    COUNT(events_with_time) AS total_eventos;

-- A3: Estadísticas (promedio de fiabilidad, rating, total de likes) por comuna y tipo de evento
grouped_stats_comuna_tipo = GROUP events_with_time BY (comuna, tipo_es);
stats_comuna_tipo = FOREACH grouped_stats_comuna_tipo GENERATE
    FLATTEN(group) AS (comuna, tipo_es),
    AVG(events_with_time.fiabilidad) AS promedio_fiabilidad,
    AVG(events_with_time.rating_evento) AS promedio_rating_evento,
    SUM(events_with_time.n_likes) AS total_likes,
    COUNT(events_with_time) AS total_eventos_para_stats;

-- A4: Top 5 tipos de evento más reportados en general
grouped_tipos_general = GROUP events_with_time BY tipo_es;
conteo_tipos_general = FOREACH grouped_tipos_general GENERATE
    group AS tipo_es,
    COUNT(events_with_time) AS total_eventos;
ordenado_tipos_general = ORDER conteo_tipos_general BY total_eventos DESC;
top5_tipos_evento_general = LIMIT ordenado_tipos_general 5;

-- A5: Top 5 comunas con más eventos reportados
grouped_comunas_general = GROUP events_with_time BY comuna;
conteo_comunas_general = FOREACH grouped_comunas_general GENERATE
    group AS comuna,
    COUNT(events_with_time) AS total_eventos;
ordenado_comunas_general = ORDER conteo_comunas_general BY total_eventos DESC;
top5_comunas_eventos_general = LIMIT ordenado_comunas_general 5;

-- A6: Conteo de eventos por día de la semana y tipo de evento
grouped_diasemana_tipo = GROUP events_with_time BY (dia_semana, tipo_es);
conteo_diasemana_tipo = FOREACH grouped_diasemana_tipo GENERATE
    FLATTEN(group) AS (dia_semana, tipo_es),
    COUNT(events_with_time) AS total_eventos;



STORE conteo_comuna_tipo INTO 'output/conteo_eventos_por_comuna_tipo' USING PigStorage(',');
STORE conteo_tipo_hora INTO 'output/conteo_eventos_por_tipo_hora' USING PigStorage(',');
STORE stats_comuna_tipo INTO 'output/estadisticas_por_comuna_tipo' USING PigStorage(',');
STORE top5_tipos_evento_general INTO 'output/top5_tipos_evento' USING PigStorage(',');
STORE top5_comunas_eventos_general INTO 'output/top5_comunas_con_eventos' USING PigStorage(',');
STORE conteo_diasemana_tipo INTO 'output/conteo_eventos_por_diasemana_tipo' USING PigStorage(',');


DESCRIBE events_with_time; 
STORE events_with_time INTO 'output/tabla_eventos_enriquecidos_final' USING PigStorage(',');