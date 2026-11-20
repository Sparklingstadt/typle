# The production image of the web app (docs/superpowers/specs/2026-11-20-aws-migration-design.md): a standalone
# Next.js server on :3000, plus scripts/migrate.cjs to run the migrations as a one-off task with the same image.
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

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /src/.next-production/standalone/ ./
COPY --from=build --chown=node:node /src/.next-production/static ./.next-production/static
COPY --from=build --chown=node:node /src/public ./public
COPY --from=build --chown=node:node /src/scripts/migrate.cjs ./scripts/migrate.cjs
COPY --from=build --chown=node:node /src/db/migrations ./db/migrations
# The CA bundle of Amazon RDS: DATABASE_URL=...?sslmode=verify-full&sslrootcert=/app/certs/rds-global-bundle.pem
ADD --chown=node:node https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem ./certs/rds-global-bundle.pem
USER node
EXPOSE 3000
CMD ["node", "server.js"]
