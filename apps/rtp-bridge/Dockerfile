# Build context: apps/rtp-bridge (docker-compose.yml sets context: apps/rtp-bridge)
# Build: docker compose build rtp-bridge
#
# Ports (all match main.go defaults via env vars):
#   8080 — external HTTP/WS for Twilio Media Streams
#   8081 — internal WebSocket for realtime-core
#   9090 — Prometheus metrics (not published to host)

# ─── Stage 1: Go build ───────────────────────────────────────────────────────
FROM golang:1.21-alpine AS builder

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o rtp-bridge main.go

# ─── Stage 2: minimal runtime image ──────────────────────────────────────────
FROM alpine:latest

RUN apk --no-cache add ca-certificates wget

WORKDIR /app
COPY --from=builder /build/rtp-bridge .

EXPOSE 8080 8081 9090

# Health check hits the external HTTP server's /healthz endpoint (main.go).
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:8080/healthz || exit 1

CMD ["./rtp-bridge"]
