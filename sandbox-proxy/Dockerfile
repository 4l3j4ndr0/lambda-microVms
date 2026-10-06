FROM node:22-alpine

WORKDIR /app

# Instalar dependencias primero (mejor cacheo de capas)
COPY package.json ./
RUN npm install --omit=dev

# Código
COPY src ./src
COPY provision ./provision

# El proxy escucha en 8443 (HTTP detrás de nginx, o HTTPS si se montan certs)
EXPOSE 8443

ENV NODE_ENV=production
CMD ["node", "src/server.js"]
