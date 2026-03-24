package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"github.com/gorilla/websocket"
)

var (
	httpPort      = getEnv("HTTP_PORT", "8080")       // External port for Twilio
	internalPort  = getEnv("INTERNAL_PORT", "8081")   // Internal port for realtime-core
	metricsPort   = getEnv("METRICS_PORT", "9090")
	sipDomain     = getEnv("SIP_DOMAIN", "localhost")
	authToken     = getEnv("RTP_AUTH_TOKEN", "")
)

type MediaBridge struct {
	sessions sync.Map // callId -> *MediaSession
	upgrader websocket.Upgrader
	mu       sync.RWMutex
}

type MediaSession struct {
	callID           string
	streamSid        string           // Twilio stream identifier (required for outbound media)
	twilioConn       *websocket.Conn  // Connection to Twilio
	realtimeCoreConn *websocket.Conn  // Connection to realtime-core
	ctx              context.Context
	cancel           context.CancelFunc
	mu               sync.RWMutex
	framesSent       int              // Track outbound frames to Twilio
	framesReceived   int              // Track inbound frames from Twilio
}

func main() {
	log.Println("Starting rTP bridge service...")
	
	bridge := &MediaBridge{
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}

	// Health check endpoint
	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})

	// Metrics endpoint (Prometheus format)
	http.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		// TODO: expose prom metrics
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("# HELP rtp_active_sessions Active media sessions\n"))
		w.Write([]byte("# TYPE rtp_active_sessions gauge\n"))
		count := 0
		bridge.sessions.Range(func(_, _ interface{}) bool {
			count++
			return true
		})
		w.Write([]byte(fmt.Sprintf("rtp_active_sessions %d\n", count)))
	})

	// WebSocket endpoint for Twilio Media Streams (on external server)
	http.HandleFunc("/stream/", func(w http.ResponseWriter, r *http.Request) {
		bridge.handleTwilioStream(w, r)
	})

	// Start external HTTP server (for Twilio)
	go func() {
		addr := fmt.Sprintf(":%s", httpPort)
		log.Printf("External HTTP server (Twilio) listening on %s", addr)
		if err := http.ListenAndServe(addr, nil); err != nil {
			log.Fatalf("External HTTP server failed: %v", err)
		}
	}()

	// Start internal WebSocket server (for realtime-core)
	internalMux := http.NewServeMux()
	internalMux.HandleFunc("/ws/media", func(w http.ResponseWriter, r *http.Request) {
		bridge.handleRealtimeCoreConnection(w, r)
	})
	
	go func() {
		addr := fmt.Sprintf(":%s", internalPort)
		log.Printf("Internal WebSocket server (realtime-core) listening on %s", addr)
		if err := http.ListenAndServe(addr, internalMux); err != nil {
			log.Fatalf("Internal WebSocket server failed: %v", err)
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
		callID: callID,
		ctx:    ctx,
		cancel: cancel,
	}
	b.sessions.Store(callID, session)
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
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	realtimeCoreWs, err := b.upgrader.Upgrade(w, r, nil)
	if err != nil {
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
		log.Printf("[RTP-BRIDGE] ERROR: forward to realtime-core failed, call=%s, err=%v", s.callID, err)
	} else {
		s.mu.Lock()
		s.framesReceived++
		frames := s.framesReceived
		s.mu.Unlock()
		
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
		log.Printf("[RTP-BRIDGE] ERROR: send to Twilio failed, call=%s, err=%v", s.callID, err)
	} else {
		s.mu.Lock()
		s.framesSent++
		frames := s.framesSent
		s.mu.Unlock()
		
		// Throttled progress log: every 50th frame (~1 second)
		if frames%50 == 0 {
			log.Printf("[RTP-BRIDGE] egress_progress call=%s frames=%d streamSid=%s", s.callID, frames, streamSid)
		}
	}
}

func (s *MediaSession) close() {
	s.cancel()
	
	s.mu.Lock()
	defer s.mu.Unlock()

	// Log session summary before closing
	log.Printf("[RTP-BRIDGE] session_summary call=%s frames_sent=%d frames_received=%d", 
		s.callID, s.framesSent, s.framesReceived)

	if s.twilioConn != nil {
		s.twilioConn.Close()
		s.twilioConn = nil
	}

	if s.realtimeCoreConn != nil {
		s.realtimeCoreConn.Close()
		s.realtimeCoreConn = nil
	}

	log.Printf("[RTP-BRIDGE] Closed media session for call %s", s.callID)
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}






