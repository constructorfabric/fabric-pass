FROM alpine:3.20
RUN apk add --no-cache docker-cli docker-cli-compose nodejs
# Both modules, in one directory — server.mjs imports './verify.mjs' at
# runtime, so shipping only the entrypoint would fail at startup.
COPY server.mjs verify.mjs /app/
CMD ["node", "/app/server.mjs"]
