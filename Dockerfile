# The container image of Typle on AWS (ECS Fargate, infra/aws). Vercel does not use it.
# Build: docker build --platform linux/arm64 -t typle-r .

FROM node:24-bookworm-slim AS build
WORKDIR /app
# The whole source before `npm ci`: its postinstall (scripts/generate-licenses.cjs) reads files in public/ and scripts/.
COPY . .
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
ENV NEXT_TELEMETRY_DISABLED=1 TYPLE_STANDALONE=1
RUN npm run build \
  && cp -r public .next-production/standalone/ \
  && cp -r .next-production/static .next-production/standalone/.next-production/

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# Amazon RDS's certificate authorities, so the connection to the database is verified (sslmode=verify-full). Put in a
# directory that exists: ADD would make missing parents (/etc/ssl) unreadable, and Node.js then fails to read OpenSSL's
# configuration there.
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /usr/local/share/rds-global-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/rds-global-bundle.pem
COPY --from=build --chown=node:node /app/.next-production/standalone ./
# scripts/migrate.cjs and the migrations it applies before the server starts (docker-entrypoint.sh).
COPY --from=build --chown=node:node /app/scripts/migrate.cjs ./scripts/migrate.cjs
COPY --from=build --chown=node:node /app/db/migrations ./db/migrations
COPY --chmod=755 scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
USER node
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
