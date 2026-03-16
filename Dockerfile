FROM mcr.microsoft.com/playwright:v1.57.0-noble

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

CMD ["node", "app.js"]