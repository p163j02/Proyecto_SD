import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import os

print("Directorio actual:", os.getcwd())
print("Archivos en el directorio:", os.listdir())

os.chdir(os.path.dirname(os.path.abspath(__file__)))

sns.set_theme(style="whitegrid")
palette_comunas = "viridis"
palette_tipos = "magma"
palette_horas = "coolwarm"
palette_dias = "cubehelix"
palette_stats = "crest"

sns.set_theme(style="whitegrid")

df_top_comunas = pd.read_csv('top5_comunas_con_eventos.csv', header=None, names=[
                             'comuna', 'total_eventos'])
plt.figure(figsize=(10, 6))
barplot_comunas = sns.barplot(x='total_eventos', y='comuna', data=df_top_comunas,
                              palette="viridis", hue='comuna', dodge=False, legend=False)
plt.title('Top 5 Comunas con Mayor Número de Eventos de Tráfico')
plt.xlabel('Total de Eventos')
plt.ylabel('Comuna')
for index, value in enumerate(df_top_comunas['total_eventos']):
    barplot_comunas.text(value + 5, index, str(value),
                         color='black', va="center")
plt.tight_layout()
plt.savefig('grafico_top_comunas.png')
plt.close()
print("Gráfico 'grafico_top_comunas.png' generado.")

df_top_tipos = pd.read_csv('top5_tipos_evento.csv', header=None, names=[
                           'tipo_es', 'total_eventos'])
plt.figure(figsize=(10, 6))
barplot_tipos = sns.barplot(x='total_eventos', y='tipo_es', data=df_top_tipos,
                            palette="magma", hue='tipo_es', dodge=False, legend=False)
plt.title('Top 5 Tipos de Evento de Tráfico Más Frecuentes')
plt.xlabel('Total de Eventos')
plt.ylabel('Tipo de Evento')
for index, value in enumerate(df_top_tipos['total_eventos']):
    barplot_tipos.text(value + 5, index, str(value),
                       color='black', va="center")
plt.tight_layout()
plt.savefig('grafico_top_tipos.png')
plt.close()
print("Gráfico 'grafico_top_tipos.png' generado.")

df_tipo_hora = pd.read_csv('conteo_eventos_por_tipo_hora.csv', header=None, names=[
                           'tipo_es', 'hora_dia', 'total_eventos'])
df_congestion_hora = df_tipo_hora[df_tipo_hora['tipo_es']
                                  == 'CONGESTION'].sort_values(by='hora_dia')
if not df_congestion_hora.empty:
    plt.figure(figsize=(12, 6))
    sns.lineplot(x='hora_dia', y='total_eventos',
                 data=df_congestion_hora, marker='o', color='dodgerblue')
    plt.title('Eventos de CONGESTION por Hora del Día')
    plt.xlabel('Hora del Día (0-23)')
    plt.ylabel('Número de Eventos de Congestión')
    plt.xticks(range(0, 24))
    plt.grid(True, which='both', linestyle='--', linewidth=0.5)
    plt.tight_layout()
    plt.savefig('grafico_congestion_por_hora.png')
    plt.close()
    print("Gráfico 'grafico_congestion_por_hora.png' generado.")
else:
    print("No se encontraron datos de CONGESTION para el gráfico por hora.")

df_accidente_hora = df_tipo_hora[df_tipo_hora['tipo_es']
                                 == 'ACCIDENTE'].sort_values(by='hora_dia')
if not df_accidente_hora.empty:
    plt.figure(figsize=(12, 6))
    sns.lineplot(x='hora_dia', y='total_eventos',
                 data=df_accidente_hora, marker='o', color='crimson')
    plt.title('Eventos de ACCIDENTE por Hora del Día')
    plt.xlabel('Hora del Día (0-23)')
    plt.ylabel('Número de Accidentes')
    plt.xticks(range(0, 24))
    plt.grid(True, which='both', linestyle='--', linewidth=0.5)
    plt.tight_layout()
    plt.savefig('grafico_accidente_por_hora.png')
    plt.close()
    print("Gráfico 'grafico_accidente_por_hora.png' generado.")
else:
    print("No se encontraron datos de ACCIDENTE para el gráfico por hora.")

df_policia_hora = df_tipo_hora[df_tipo_hora['tipo_es']
                               == 'POLICIA'].sort_values(by='hora_dia')
if not df_policia_hora.empty:
    plt.figure(figsize=(12, 6))
    sns.lineplot(x='hora_dia', y='total_eventos',
                 data=df_policia_hora, marker='o', color='crimson')
    plt.title('Eventos de POLICIA por Hora del Día')
    plt.xlabel('Hora del Día (0-23)')
    plt.ylabel('Número de Eventos Policia')
    plt.xticks(range(0, 24))
    plt.grid(True, which='both', linestyle='--', linewidth=0.5)
    plt.tight_layout()
    plt.savefig('grafico_policia_por_hora.png')
    plt.close()
    print("Gráfico 'grafico_policia_por_hora.png' generado.")
else:
    print("No se encontraron datos de POLICIA para el gráfico por hora.")


print("\n--- Procesando estadisticas_por_comuna_tipo.csv ---")
try:
    df_stats = pd.read_csv('estadisticas_por_comuna_tipo.csv', header=None, names=[
                           'comuna', 'tipo_es', 'promedio_fiabilidad', 'promedio_rating_evento', 'total_likes', 'total_eventos_para_stats'])
    if not df_stats.empty:
        cols_to_numeric = ['promedio_fiabilidad', 'promedio_rating_evento',
                           'total_likes', 'total_eventos_para_stats']
        for col in cols_to_numeric:
            df_stats[col] = pd.to_numeric(df_stats[col], errors='coerce')
        df_stats = df_stats.fillna(0)

        df_fiabilidad_tipo = df_stats.groupby('tipo_es').apply(
            lambda x: (x['promedio_fiabilidad'] * x['total_eventos_para_stats']).sum() /
            x['total_eventos_para_stats'].sum(
            ) if x['total_eventos_para_stats'].sum() > 0 else 0
        ).reset_index(name='fiabilidad_general_ponderada').sort_values(by='fiabilidad_general_ponderada', ascending=False)

        if not df_fiabilidad_tipo.empty:
            plt.figure(figsize=(12, 8))
            barplot_fiabilidad = sns.barplot(x='fiabilidad_general_ponderada', y='tipo_es',
                                             data=df_fiabilidad_tipo, palette=palette_stats, hue='tipo_es', dodge=False, legend=False)
            plt.title('Promedio Ponderado de Fiabilidad por Tipo de Evento')
            plt.xlabel('Promedio Ponderado de Fiabilidad (0-10)')
            plt.ylabel('Tipo de Evento')
            plt.xlim(0, 10)

            for i, bar in enumerate(barplot_fiabilidad.patches):
                value = bar.get_width()
                y_pos = bar.get_y() + bar.get_height() / 2
                plt.text(value + 0.1, y_pos,
                         f"{value:.2f}", va='center', ha='left', color='black')

            plt.tight_layout()
            plt.savefig('grafico_fiabilidad_por_tipo.png')
            plt.close()
            print("Gráfico 'grafico_fiabilidad_por_tipo.png' generado.")
        else:
            print(
                "No hay datos suficientes para generar 'grafico_fiabilidad_por_tipo.png'.")

        df_likes_tipo = df_stats.groupby('tipo_es')['total_likes'].sum(
        ).reset_index().sort_values(by='total_likes', ascending=False).head(10)
        if not df_likes_tipo.empty:
            plt.figure(figsize=(12, 8))
            barplot_likes = sns.barplot(x='total_likes', y='tipo_es', data=df_likes_tipo,
                                        palette=palette_stats, hue='tipo_es', dodge=False, legend=False)
            plt.title('Total de "Likes" (Confirmaciones) por Tipo de Evento')
            plt.xlabel('Total de Likes')
            plt.ylabel('Tipo de Evento')

            for i, bar in enumerate(barplot_likes.patches):
                value = bar.get_width()
                y_pos = bar.get_y() + bar.get_height() / 2
                plt.text(value + 5, y_pos, str(int(value)),
                         va='center', ha='left', color='black')

            plt.tight_layout()
            plt.savefig('grafico_likes_por_tipo.png')
            plt.close()
            print("Gráfico 'grafico_likes_por_tipo.png' generado.")
        else:
            print("No hay datos suficientes para generar 'grafico_likes_por_tipo.png'.")

        df_rating_tipo = df_stats.groupby('tipo_es').apply(
            lambda x: (x['promedio_rating_evento'] * x['total_eventos_para_stats']).sum() /
            x['total_eventos_para_stats'].sum(
            ) if x['total_eventos_para_stats'].sum() > 0 else 0
        ).reset_index(name='rating_general_ponderado').sort_values(by='rating_general_ponderado', ascending=False)

        if not df_rating_tipo.empty:
            plt.figure(figsize=(12, 8))
            barplot_rating = sns.barplot(x='rating_general_ponderado', y='tipo_es', data=df_rating_tipo,
                                         palette="coolwarm_r", hue='tipo_es', dodge=False, legend=False)
            plt.title(
                'Promedio Ponderado de Rating del Evento por Tipo de Evento')
            plt.xlabel('Promedio Ponderado de Rating (ej. 1-5)')
            plt.ylabel('Tipo de Evento')

            for i, bar in enumerate(barplot_rating.patches):
                value = bar.get_width()
                y_pos = bar.get_y() + bar.get_height() / 2
                plt.text(value + 0.05, y_pos,
                         f"{value:.2f}", va='center', ha='left', color='black')

            plt.tight_layout()
            plt.savefig('grafico_rating_por_tipo.png')
            plt.close()
            print("Gráfico 'grafico_rating_por_tipo.png' generado.")
        else:
            print("No hay datos suficientes para generar 'grafico_rating_por_tipo.png'.")

    else:
        print("ADVERTENCIA: El archivo 'estadisticas_por_comuna_tipo.csv' está vacío o no se pudo leer.")
except FileNotFoundError:
    print("ERROR: No se encontró el archivo 'estadisticas_por_comuna_tipo.csv'")
except Exception as e:
    print(f"Error al procesar 'estadisticas_por_comuna_tipo.csv': {e}")

print("Proceso de generación de gráficos completado.")
