FROM node:20-alpine

# Install docker CLI and docker compose plugin
RUN apk add --no-cache docker-cli docker-cli-compose git

WORKDIR /app
COPY package.json server.js ./

EXPOSE 3701
CMD ["node", "server.js"]
