package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

var (
	httpPort     = getEnv("HTTP_PORT", "8080")     // External port for Twilio + health
	internalPort = getEnv("INTERNAL_PORT", "8081") // Internal port for realtime-core WS
	metricsPort  = getEnv("METRICS_PORT", "9090")
	sipDomain    = getEnv("SIP_DOMAIN", "localhost")
	authToken    = getEnv("RTP_AUTH_TOKEN", "")
)

type BridgeMetrics struct {
	mu sync.Mutex

	activeSessions  uint64
	sessionsStarted uint64
	sessionsEnded   uint64

	ingressFrames uint64
	egressFrames  uint64

	websocketErrors map[string]uint64

	durationBuckets      []float64
	durationBucketCounts []uint64
	durationOverflow     uint64
	durationCount        uint64
	durationSumSeconds   float64
}

type BridgeMetricsSnapshot struct {
	activeSessions  uint64
	sessionsStarted uint64
	sessionsEnded   uint64
	ingressFrames   uint64
	egressFrames    uint64
	websocketErrors map[string]uint64

	durationBuckets      []float64
	durationBucketCounts []uint64
	durationOverflow     uint64
	durationCount        uint64
	durationSumSeconds   float64
}

func newBridgeMetrics() *BridgeMetrics {
	buckets := []float64{0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600}
	return &BridgeMetrics{
		websocketErrors:      make(map[string]uint64),
		durationBuckets:      buckets,
		durationBucketCounts: make([]uint64, len(buckets)),
	}
}

func (m *BridgeMetrics) observeSessionCreated() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessionsStarted++
	m.activeSessions++
}

func (m *BridgeMetrics) observeSessionClosed(duration time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.activeSessions > 0 {
		m.activeSessions--
	}
	m.sessionsEnded++

	sec := duration.Seconds()
	m.durationCount++
	m.durationSumSeconds += sec

	idx := -1
	for i, bucket := range m.durationBuckets {
		if sec <= bucket {
			idx = i
			break
		}
	}
	if idx >= 0 {
		m.durationBucketCounts[idx]++
	} else {
		m.durationOverflow++
	}
}

func (m *BridgeMetrics) incIngressFrame() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ingressFrames++
}

func (m *BridgeMetrics) incEgressFrame() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.egressFrames++
}

func (m *BridgeMetrics) incWebSocketError(stage string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.websocketErrors[stage]++
}

func (m *BridgeMetrics) snapshot() BridgeMetricsSnapshot {
	m.mu.Lock()
	defer m.mu.Unlock()

	wsCopy := make(map[string]uint64, len(m.websocketErrors))
	for k, v := range m.websocketErrors {
		wsCopy[k] = v
	}

	bucketsCopy := append([]float64(nil), m.durationBuckets...)
	bucketCountsCopy := append([]uint64(nil), m.durationBucketCounts...)

	return BridgeMetricsSnapshot{
		activeSessions:       m.activeSessions,
		sessionsStarted:      m.sessionsStarted,
		sessionsEnded:        m.sessionsEnded,
		ingressFrames:        m.ingressFrames,
		egressFrames:         m.egressFrames,
		websocketErrors:      wsCopy,
		durationBuckets:      bucketsCopy,
		durationBucketCounts: bucketCountsCopy,
		durationOverflow:     m.durationOverflow,
		durationCount:        m.durationCount,
		durationSumSeconds:   m.durationSumSeconds,
	}
}

func (m *BridgeMetrics) writePrometheus(w http.ResponseWriter) {
	snap := m.snapshot()
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.WriteHeader(http.StatusOK)

	fmt.Fprintln(w, "# HELP rtp_active_sessions Active media sessions")
	fmt.Fprintln(w, "# TYPE rtp_active_sessions gauge")
	fmt.Fprintf(w, "rtp_active_sessions %d\n", snap.activeSessions)

	fmt.Fprintln(w, "# HELP rtp_sessions_started_total Total RTP bridge sessions started")
	fmt.Fprintln(w, "# TYPE rtp_sessions_started_total counter")
	fmt.Fprintf(w, "rtp_sessions_started_total %d\n", snap.sessionsStarted)

	fmt.Fprintln(w, "# HELP rtp_sessions_ended_total Total RTP bridge sessions ended")
	fmt.Fprintln(w, "# TYPE rtp_sessions_ended_total counter")
	fmt.Fprintf(w, "rtp_sessions_ended_total %d\n", snap.sessionsEnded)

	fmt.Fprintln(w, "# HELP rtp_ingress_frames_total Audio frames forwarded from Twilio to realtime-core")
	fmt.Fprintln(w, "# TYPE rtp_ingress_frames_total counter")
	fmt.Fprintf(w, "rtp_ingress_frames_total %d\n", snap.ingressFrames)

	fmt.Fprintln(w, "# HELP rtp_egress_frames_total Audio frames forwarded from realtime-core to Twilio")
	fmt.Fprintln(w, "# TYPE rtp_egress_frames_total counter")
	fmt.Fprintf(w, "rtp_egress_frames_total %d\n", snap.egressFrames)

	fmt.Fprintln(w, "# HELP rtp_websocket_errors_total WebSocket errors grouped by stage")
	fmt.Fprintln(w, "# TYPE rtp_websocket_errors_total counter")
	stages := make([]string, 0, len(snap.websocketErrors))
	for stage := range snap.websocketErrors {
		stages = append(stages, stage)
	}
	sort.Strings(stages)
	for _, stage := range stages {
		fmt.Fprintf(w, "rtp_websocket_errors_total{stage=\"%s\"} %d\n", stage, snap.websocketErrors[stage])
	}

	fmt.Fprintln(w, "# HELP rtp_session_duration_seconds RTP bridge session duration in seconds")
	fmt.Fprintln(w, "# TYPE rtp_session_duration_seconds histogram")
	cumulative := uint64(0)
	for i, bucket := range snap.durationBuckets {
		cumulative += snap.durationBucketCounts[i]
		fmt.Fprintf(w, "rtp_session_duration_seconds_bucket{le=\"%.3f\"} %d\n", bucket, cumulative)
	}
	cumulative += snap.durationOverflow
	fmt.Fprintf(w, "rtp_session_duration_seconds_bucket{le=\"+Inf\"} %d\n", cumulative)
	fmt.Fprintf(w, "rtp_session_duration_seconds_sum %.6f\n", snap.durationSumSeconds)
	fmt.Fprintf(w, "rtp_session_duration_seconds_count %d\n", snap.durationCount)
}

type MediaBridge struct {
	sessions sync.Map // callId -> *MediaSession
	upgrader websocket.Upgrader
	mu       sync.RWMutex
	metrics  *BridgeMetrics
}

type MediaSession struct {
	callID           string
	streamSid        string          // Twilio stream identifier (required for outbound media)
	twilioConn       *websocket.Conn // Connection to Twilio
	realtimeCoreConn *websocket.Conn // Connection to realtime-core
	ctx              context.Context
	cancel           context.CancelFunc
	mu               sync.RWMutex
	framesSent       int // Track outbound frames to Twilio
	framesReceived   int // Track inbound frames from Twilio
	startedAt        time.Time
	closed           bool
	metrics          *BridgeMetrics
}

func main() {
	log.Println("Starting rTP bridge service...")
	log.Printf("RTP bridge config: http_port=%s internal_port=%s metrics_port=%s sip_domain=%s", httpPort, internalPort, metricsPort, sipDomain)

	bridge := &MediaBridge{
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
		metrics: newBridgeMetrics(),
	}

	externalMux := http.NewServeMux()
	externalMux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})
	externalMux.HandleFunc("/stream/", func(w http.ResponseWriter, r *http.Request) {
		bridge.handleTwilioStream(w, r)
	})

	internalMux := http.NewServeMux()
	internalMux.HandleFunc("/ws/media", func(w http.ResponseWriter, r *http.Request) {
		bridge.handleRealtimeCoreConnection(w, r)
	})

	metricsMux := http.NewServeMux()
	metricsMux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		bridge.metrics.writePrometheus(w)
	})

	// Start external HTTP server (Twilio + health)
	go func() {
		addr := fmt.Sprintf(":%s", httpPort)
		log.Printf("External HTTP server (Twilio + health) listening on %s", addr)
		if err := http.ListenAndServe(addr, externalMux); err != nil {
			log.Fatalf("External HTTP server failed: %v", err)
		}
	}()

	// Start internal WebSocket server (realtime-core)
	go func() {
		addr := fmt.Sprintf(":%s", internalPort)
		log.Printf("Internal WebSocket server (realtime-core) listening on %s", addr)
		if err := http.ListenAndServe(addr, internalMux); err != nil {
			log.Fatalf("Internal WebSocket server failed: %v", err)
		}
	}()

	// Start metrics server
	go func() {
		addr := fmt.Sprintf(":%s", metricsPort)
		log.Printf("Metrics server listening on %s", addr)
		if err := http.ListenAndServe(addr, metricsMux); err != nil {
			log.Fatalf("Metrics server failed: %v", err)
		}
	}()

	// Wait for interrupt
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	<-sigChan
	log.Println("Shutting down...")
}

func (b *MediaBridge) handleTwilioStream(w http.ResponseWriter, r *http.Request) {
	// Extract call ID from URL path
	callID := r.URL.Path[len("/stream/"):]
	if callID == "" {
		http.Error(w, "call_id required in path", http.StatusBadRequest)
		return
	}

	twilioWs, err := b.upgrader.Upgrade(w, r, nil)
	if err != nil {
		b.metrics.incWebSocketError("twilio_upgrade")
		log.Printf("Twilio WebSocket upgrade failed: %v", err)
		return
	}
	defer twilioWs.Close()

	log.Printf("Twilio Media Stream connected for call %s", callID)

	// Create or get session
	session := b.getOrCreateSession(callID)
	session.mu.Lock()
	session.twilioConn = twilioWs
	session.mu.Unlock()

	// Process Twilio messages
	for {
		var msg map[string]interface{}
		if err := twilioWs.ReadJSON(&msg); err != nil {
			b.metrics.incWebSocketError("twilio_read")
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("Twilio WebSocket error: %v", err)
			}
			break
		}

		event, ok := msg["event"].(string)
		if !ok {
			continue
		}

		switch event {
		case "connected":
			log.Printf("[Twilio] Stream connected: %s", callID)
		case "start":
			// Extract streamSid from start event - REQUIRED for outbound media
			if start, ok := msg["start"].(map[string]interface{}); ok {
				if streamSid, ok := start["streamSid"].(string); ok {
					session.mu.Lock()
					session.streamSid = streamSid
					session.mu.Unlock()
					log.Printf("[Twilio] Stream started: %s, streamSid=%s", callID, streamSid)
				} else {
					log.Printf("[Twilio] Stream started: %s (WARNING: no streamSid found)", callID)
				}
			} else {
				log.Printf("[Twilio] Stream started: %s (WARNING: malformed start event)", callID)
			}
		case "media":
			// Forward audio to realtime-core (no log spam)
			session.forwardToRealtimeCore(msg)
		case "stop":
			log.Printf("[Twilio] Stream stopped: %s", callID)
			session.close()
			b.sessions.Delete(callID)
			return
		}
	}

	session.close()
	b.sessions.Delete(callID)
}

// Get or create a media session
func (b *MediaBridge) getOrCreateSession(callID string) *MediaSession {
	if val, ok := b.sessions.Load(callID); ok {
		return val.(*MediaSession)
	}

	ctx, cancel := context.WithCancel(context.Background())
	session := &MediaSession{
		callID:    callID,
		ctx:       ctx,
		cancel:    cancel,
		startedAt: time.Now(),
		metrics:   b.metrics,
	}
	b.sessions.Store(callID, session)
	b.metrics.observeSessionCreated()
	log.Printf("Created new media session for call %s", callID)
	return session
}

// Handle realtime-core WebSocket connection
func (b *MediaBridge) handleRealtimeCoreConnection(w http.ResponseWriter, r *http.Request) {
	callID := r.URL.Query().Get("call_id")
	if callID == "" {
		http.Error(w, "call_id required", http.StatusBadRequest)
		return
	}

	// Verify auth token
	if authToken != "" && r.Header.Get("Authorization") != "Bearer "+authToken {
		b.metrics.incWebSocketError("internal_auth")
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	realtimeCoreWs, err := b.upgrader.Upgrade(w, r, nil)
	if err != nil {
		b.metrics.incWebSocketError("internal_upgrade")
		log.Printf("realtime-core WebSocket upgrade failed: %v", err)
		return
	}
	defer realtimeCoreWs.Close()

	log.Printf("realtime-core connected for call %s", callID)

	// Get or create session
	session := b.getOrCreateSession(callID)
	session.mu.Lock()
	session.realtimeCoreConn = realtimeCoreWs
	session.mu.Unlock()

	// Process messages from realtime-core (TTS audio to send back to Twilio)
	for {
		var msg map[string]interface{}
		if err := realtimeCoreWs.ReadJSON(&msg); err != nil {
			b.metrics.incWebSocketError("internal_read")
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("realtime-core WebSocket error: %v", err)
			}
			break
		}

		msgType, ok := msg["type"].(string)
		if !ok {
			continue
		}

		switch msgType {
		case "audio":
			// Audio from realtime-core (TTS) - forward to Twilio
			session.forwardToTwilio(msg)
		case "end":
			log.Printf("realtime-core ended call: %s", callID)
			session.close()
			b.sessions.Delete(callID)
			return
		}
	}

	session.close()
}

// MediaSession methods
func (s *MediaSession) forwardToRealtimeCore(twilioMsg map[string]interface{}) {
	s.mu.Lock()
	conn := s.realtimeCoreConn
	s.mu.Unlock()

	if conn == nil {
		// realtime-core not connected yet, buffer or drop
		return
	}

	// Extract audio payload from Twilio format
	payload, ok := twilioMsg["media"].(map[string]interface{})
	if !ok {
		return
	}

	// CRITICAL: Only forward inbound track (caller audio) to STT
	// Ignore outbound track (our TTS echo) to prevent feedback loop
	track, _ := payload["track"].(string)
	if track != "inbound" {
		return
	}

	audioData, ok := payload["payload"].(string)
	if !ok {
		return
	}

	// Forward to realtime-core in expected format
	msg := map[string]interface{}{
		"type":    "audio",
		"payload": audioData,
	}

	if err := conn.WriteJSON(msg); err != nil {
		if s.metrics != nil {
			s.metrics.incWebSocketError("internal_write")
		}
		log.Printf("[RTP-BRIDGE] ERROR: forward to realtime-core failed, call=%s, err=%v", s.callID, err)
	} else {
		s.mu.Lock()
		s.framesReceived++
		frames := s.framesReceived
		s.mu.Unlock()

		if s.metrics != nil {
			s.metrics.incIngressFrame()
		}

		// Throttled logging: every 50th frame (~1 second)
		if frames%50 == 0 {
			log.Printf("[RTP-BRIDGE] ingress_progress call=%s frames=%d", s.callID, frames)
		}
	}
}

func (s *MediaSession) forwardToTwilio(realtimeCoreMsg map[string]interface{}) {
	s.mu.Lock()
	conn := s.twilioConn
	streamSid := s.streamSid
	s.mu.Unlock()

	if conn == nil {
		log.Printf("[RTP-BRIDGE] WARN: no Twilio conn for call %s", s.callID)
		return
	}

	// Extract audio payload
	audioData, ok := realtimeCoreMsg["payload"].(string)
	if !ok {
		return
	}

	// Send to Twilio in Media Stream format with streamSid (REQUIRED!)
	twilioMsg := map[string]interface{}{
		"event":     "media",
		"streamSid": streamSid,
		"media": map[string]interface{}{
			"payload": audioData,
		},
	}

	if err := conn.WriteJSON(twilioMsg); err != nil {
		if s.metrics != nil {
			s.metrics.incWebSocketError("twilio_write")
		}
		log.Printf("[RTP-BRIDGE] ERROR: send to Twilio failed, call=%s, err=%v", s.callID, err)
	} else {
		s.mu.Lock()
		s.framesSent++
		frames := s.framesSent
		s.mu.Unlock()

		if s.metrics != nil {
			s.metrics.incEgressFrame()
		}

		// Throttled progress log: every 50th frame (~1 second)
		if frames%50 == 0 {
			log.Printf("[RTP-BRIDGE] egress_progress call=%s frames=%d streamSid=%s", s.callID, frames, streamSid)
		}
	}
}

func (s *MediaSession) close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true

	framesSent := s.framesSent
	framesReceived := s.framesReceived
	startedAt := s.startedAt

	if s.twilioConn != nil {
		s.twilioConn.Close()
		s.twilioConn = nil
	}

	if s.realtimeCoreConn != nil {
		s.realtimeCoreConn.Close()
		s.realtimeCoreConn = nil
	}
	s.mu.Unlock()

	s.cancel()

	duration := time.Since(startedAt)
	if s.metrics != nil {
		s.metrics.observeSessionClosed(duration)
	}

	// Log session summary before closing
	log.Printf("[RTP-BRIDGE] session_summary call=%s frames_sent=%d frames_received=%d duration_ms=%d",
		s.callID, framesSent, framesReceived, duration.Milliseconds())
	log.Printf("[RTP-BRIDGE] Closed media session for call %s", s.callID)
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
