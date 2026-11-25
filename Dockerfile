# The production image of the web app (docs/superpowers/specs/2026-11-20-aws-migration-design.md): a standalone
# Next.js server on :3000, plus /app/migrate to run the migrations as a one-off task with the same image
# (`npm run db:migrate` in /app/migrate: scripts/check-migrations.cjs, then prisma migrate deploy).
#   docker build --build-arg SITE_URL=https://typle.sparklingstadt.com -t typle-r .
# SITE_URL is required: sitemap.xml, robots.txt and the page metadata are built with it.

FROM node:24-slim AS build
WORKDIR /src
ARG SITE_URL
RUN test -n "$SITE_URL" || (echo "Pass --build-arg SITE_URL=<https URL of the site>" >&2; exit 1)
COPY . .
# postinstall copies the handwriting runtime into public/ and writes the licenses, so the sources come first.
RUN npm ci
RUN TYPLE_STANDALONE=1 SITE_URL="$SITE_URL" npm run build

# The migration task's files. The Prisma CLI is a devDependency, which the standalone server leaves out, so it is
# installed here on its own: the versions of package-lock.json and the db:migrate script of package.json.
FROM node:24-slim AS migrate
WORKDIR /migrate
COPY package.json package-lock.json /src/
RUN node -e " \
    const app = require('/src/package.json'), locked = require('/src/package-lock.json').packages; \
    const dependencies = Object.fromEntries(['prisma', 'pg', '@next/env'].map(name => [name, locked['node_modules/' + name].version])); \
    const scripts = { 'db:migrate': app.scripts['db:migrate'] }; \
    require('fs').writeFileSync('package.json', JSON.stringify({ private: true, scripts, dependencies }, null, 2));" \
  && npm install --no-audit --no-fund && npm cache clean --force
COPY prisma.config.ts ./
COPY prisma/schema.prisma ./prisma/
COPY scripts/check-migrations.cjs ./scripts/
COPY db/migrations ./db/migrations/

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /src/.next-production/standalone/ ./
COPY --from=build --chown=node:node /src/.next-production/static ./.next-production/static
COPY --from=build --chown=node:node /src/public ./public
COPY --from=migrate --chown=node:node /migrate ./migrate
# The CA bundle of Amazon RDS: DATABASE_URL=...?sslmode=verify-full&sslrootcert=/app/certs/rds-global-bundle.pem
ADD --chown=node:node https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem ./certs/rds-global-bundle.pem
USER node
EXPOSE 3000
CMD ["node", "server.js"]
