# Cloud image: Node app + Linux TexasSolver, so everything (LLM, OCR, solver) runs server-side.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl unzip procps libgomp1 \
  && rm -rf /var/lib/apt/lists/*

ARG TEXAS_SOLVER_URL=https://github.com/bupticybee/TexasSolver/releases/download/v0.2.0/TexasSolver-v0.2.0-Linux.zip
RUN curl -fsSL -o /tmp/ts.zip "$TEXAS_SOLVER_URL" \
  && unzip -q /tmp/ts.zip -d /tmp/ts \
  && mv /tmp/ts/TexasSolver-v0.2.0-Linux /opt/texassolver \
  && chmod +x /opt/texassolver/console_solver \
  && rm -rf /tmp/ts /tmp/ts.zip

WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci --omit=dev

COPY . .
# Run as the unprivileged `node` user; it must own logs/ for analysis logging.
RUN mkdir -p logs && chown -R node:node /app
USER node

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    TEXAS_SOLVER_BINARY=/opt/texassolver/console_solver \
    TEXAS_SOLVER_RESOURCES=/opt/texassolver/resources \
    TEXAS_SOLVER_TIMEOUT_MS=150000

EXPOSE 8080
CMD ["node", "src/server/server.js"]
