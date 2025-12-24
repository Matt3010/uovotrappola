# Usa un'immagine Node ufficiale
FROM node:20-bookworm-slim

# Installa le dipendenze di sistema necessarie per sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Crea la cartella di lavoro
WORKDIR /usr/src/app

# Copia i file dei pacchetti
COPY package*.json ./

# Installa le dipendenze (escludendo quelle di sviluppo)
RUN npm install --omit=dev

# Copia il resto del codice
COPY . .

RUN mkdir -p trappola

# Comando per avviare il bot
CMD ["node", "uovotrappola.js"]