FROM node:24-bookworm-slim AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json index.html server.js ./
COPY assets ./assets
COPY scripts/build_life_skills_site.py ./scripts/build_life_skills_site.py
COPY tests/static ./tests/static
RUN npm run check \
    && npm run build \
    && npm run check:server

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist/site ./dist/site
COPY --from=build /app/server.js ./server.js
USER node
EXPOSE 8080
CMD ["node", "server.js"]
