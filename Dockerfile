# Imagem do bot de loja (worker — sem servidor HTTP, só conexão gateway com o Discord)
FROM node:20-slim

# Diretório da aplicação
WORKDIR /app

# Instala as dependências primeiro (melhor cache de camadas)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copia o restante do código
COPY . .

ENV NODE_ENV=production

# Sobe o bot (processo de longa duração)
CMD ["npm", "run", "bot"]
