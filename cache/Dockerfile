FROM node:20.5.0-alpine3.18
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3001 
CMD [ "node", "cache.js" ]