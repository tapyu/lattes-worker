# Base do Playwright (já vem com Chromium e deps)
FROM mcr.microsoft.com/playwright:v1.47.2-jammy

WORKDIR /app

# Instala só prod deps
COPY package*.json ./
RUN npm ci --omit=dev

# Copia o resto
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Sobe o servidor
CMD ["node", "src/server.js"]

