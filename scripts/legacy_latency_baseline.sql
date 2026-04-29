-- Legacy Agents latency baseline query pack
-- Usage:
-- docker compose exec -T postgres psql -U rezovo -d rezovo -f scripts/legacy_latency_baseline.sql

\echo '=== Recent calls (usage + volume) ==='
SELECT call_id,
       status,
       started_at,
       ended_at,
       duration_sec,
       llm_tokens_in,
       llm_tokens_out,
       tts_chars,
       stt_seconds
FROM calls
ORDER BY started_at DESC
LIMIT 20;

\echo '=== Turn diagnostics p50/p95 ==='
WITH td AS (
  SELECT (payload->>'ingress_to_stt_final_ms')::numeric          AS ingress_to_stt_final_ms,
         (payload->>'stt_final_to_run_request_ms')::numeric       AS stt_final_to_run_request_ms,
         (payload->>'run_request_to_first_text_ms')::numeric      AS run_request_to_first_text_ms,
         (payload->>'first_text_delta_to_first_tts_ms')::numeric  AS first_text_to_first_tts_ms,
         (payload->>'turn_total_ms')::numeric                     AS turn_total_ms,
         (payload->>'queue_wait_p95_ms')::numeric                 AS queue_wait_p95_ms,
         (payload->>'tts_first_byte_p95_ms')::numeric             AS tts_first_byte_p95_ms,
         (payload->>'tts_synthesis_p95_ms')::numeric              AS tts_synthesis_p95_ms,
         (payload->>'stt_final_segments')::numeric                AS stt_final_segments,
         (payload->>'stt_buffered_while_processing_ms')::numeric  AS stt_buffered_while_processing_ms
  FROM call_events
  WHERE event_type = 'turn_diagnostic'
)
SELECT COUNT(*) AS turns,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY run_request_to_first_text_ms)  AS p50_run_request_to_first_text_ms,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY run_request_to_first_text_ms) AS p95_run_request_to_first_text_ms,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY first_text_to_first_tts_ms)    AS p50_first_text_to_first_tts_ms,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY first_text_to_first_tts_ms)   AS p95_first_text_to_first_tts_ms,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY turn_total_ms)                 AS p95_turn_total_ms,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY queue_wait_p95_ms)             AS p95_tts_queue_wait_ms,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY tts_first_byte_p95_ms)         AS p95_tts_first_byte_ms,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY tts_synthesis_p95_ms)          AS p95_tts_synthesis_ms,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY stt_final_segments)            AS p95_stt_final_segments,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY stt_buffered_while_processing_ms)
         AS p95_stt_buffered_while_processing_ms
FROM td
WHERE run_request_to_first_text_ms IS NOT NULL;

\echo '=== Stability counters ==='
SELECT COUNT(*) FILTER (WHERE COALESCE((payload->>'duplicate_turn_finalize_blocked')::int, 0) > 0) AS turns_with_duplicate_finalize_blocked,
       COUNT(*) FILTER (WHERE COALESCE((payload->>'stream_recovery_used')::boolean, false) = true) AS turns_with_stream_recovery,
       COUNT(*) FILTER (WHERE COALESCE((payload->>'llm_reasoning_enabled')::boolean, false) = true)
         AS turns_with_reasoning_enabled,
       AVG(COALESCE((payload->>'tts_chunks_per_turn')::numeric, 0))                                 AS avg_tts_chunks_per_turn,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY COALESCE((payload->>'tts_chunks_per_turn')::numeric, 0))
         AS p95_tts_chunks_per_turn
FROM call_events
WHERE event_type = 'turn_diagnostic';
