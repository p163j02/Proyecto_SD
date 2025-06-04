FROM openjdk:8-jdk-slim

ENV JAVA_HOME=/usr/local/openjdk-8
ENV HADOOP_VERSION=2.10.2
ENV PIG_VERSION=0.17.0
ARG PIGGYBANK_VERSION=0.17.0 # Asegúrate que esta versión es compatible con Pig 0.17.0
ENV HADOOP_HOME=/opt/hadoop
ENV PIG_HOME=/opt/pig
ENV HADOOP_CONF_DIR=$HADOOP_HOME/etc/hadoop
ENV HADOOP_DATA_DIR=/opt/hadoop/hadoop_data 
ENV PATH=$PATH:$HADOOP_HOME/bin:$HADOOP_HOME/sbin:$PIG_HOME/bin


RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    wget \
    tar \
    openssh-client \
    openssh-server \
    rsync \
    jq \
    python3 \
    python3-pip \
    curl \
    gnupg \
    apt-transport-https \
    ca-certificates && \
    echo "Instalando mongo-tools versión más reciente..." && \
    curl -fsSL https://pgp.mongodb.com/server-6.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-6.0.gpg && \
    echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-6.0.gpg ] https://repo.mongodb.org/apt/debian bullseye/mongodb-org/6.0 main" | tee /etc/apt/sources.list.d/mongodb-org-6.0.list && \
    apt-get update && \
    apt-get install -y mongodb-org-tools && \
    echo "Instalando Node.js..." && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*


RUN echo "Descargando e instalando Hadoop ${HADOOP_VERSION}..." && \
    wget https://archive.apache.org/dist/hadoop/core/hadoop-${HADOOP_VERSION}/hadoop-${HADOOP_VERSION}.tar.gz -P /tmp && \
    tar -xvf /tmp/hadoop-${HADOOP_VERSION}.tar.gz -C /opt/ && \
    mv /opt/hadoop-${HADOOP_VERSION} $HADOOP_HOME && \
    rm /tmp/hadoop-${HADOOP_VERSION}.tar.gz && \
    mkdir -p $HADOOP_DATA_DIR/hdfs/namenode && \
    mkdir -p $HADOOP_DATA_DIR/hdfs/datanode


RUN echo "Configurando variables de entorno de Hadoop..." && \
    echo "export JAVA_HOME=${JAVA_HOME}" >> $HADOOP_CONF_DIR/hadoop-env.sh && \
    echo "export HADOOP_HOME=${HADOOP_HOME}" >> $HADOOP_CONF_DIR/hadoop-env.sh && \
    echo "export HADOOP_CONF_DIR=${HADOOP_CONF_DIR}" >> $HADOOP_CONF_DIR/hadoop-env.sh && \
    echo "export HADOOP_OPTS=\"-Djava.library.path=\$HADOOP_HOME/lib/native\"" >> $HADOOP_CONF_DIR/hadoop-env.sh


COPY config/core-site.xml $HADOOP_CONF_DIR/core-site.xml
COPY config/hdfs-site.xml $HADOOP_CONF_DIR/hdfs-site.xml
COPY config/mapred-site.xml $HADOOP_CONF_DIR/mapred-site.xml
COPY config/yarn-site.xml $HADOOP_CONF_DIR/yarn-site.xml


RUN echo "Descargando e instalando Pig ${PIG_VERSION} y Piggybank ${PIGGYBANK_VERSION}..." && \
    wget https://archive.apache.org/dist/pig/pig-${PIG_VERSION}/pig-${PIG_VERSION}.tar.gz -P /tmp && \
    tar -xvf /tmp/pig-${PIG_VERSION}.tar.gz -C /opt/ && \
    mv /opt/pig-${PIG_VERSION} $PIG_HOME && \
    rm /tmp/pig-${PIG_VERSION}.tar.gz && \
    wget https://repo1.maven.org/maven2/org/apache/pig/piggybank/${PIGGYBANK_VERSION}/piggybank-${PIGGYBANK_VERSION}.jar -P $PIG_HOME/lib/


WORKDIR /app
RUN mkdir -p /app/scripts/filtrador /app/data/geo /app/datos_js_input /app/datos_js_output /app/resultados_pig_finales

RUN echo "Configurando SSH sin contraseña para root..." && \
    ssh-keygen -t rsa -P '' -f /root/.ssh/id_rsa && \
    cat /root/.ssh/id_rsa.pub >> /root/.ssh/authorized_keys && \
    chmod 0600 /root/.ssh/authorized_keys && \
    chmod 0700 /root/.ssh && \
    echo "Host localhost\n\tStrictHostKeyChecking no\n\tUserKnownHostsFile /dev/null\n" >> /root/.ssh/config && \
    echo "Host 0.0.0.0\n\tStrictHostKeyChecking no\n\tUserKnownHostsFile /dev/null\n" >> /root/.ssh/config && \
    mkdir -p /run/sshd && chmod 0755 /run/sshd


COPY scripts/filtrador/package.json /app/scripts/filtrador/
COPY scripts/filtrador/package-lock.json /app/scripts/filtrador/
COPY scripts/filtrador/preprocesar_eventos.js /app/scripts/filtrador/

RUN cd /app/scripts/filtrador && npm install --omit=dev

COPY scripts/procesar_datos.pig /app/scripts/
COPY data/geo/comunas_rm.geojson /app/data/geo/comunas_rm.geojson
COPY entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]