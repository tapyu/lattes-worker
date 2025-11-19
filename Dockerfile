# Base do Playwright (já vem com Chromium e deps)
FROM mcr.microsoft.com/playwright:v1.47.2-jammy

WORKDIR /app

# Create screenshots directory at build time so it's present with correct perms
RUN mkdir -p /app/screenshots && chmod 0777 /app/screenshots

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

