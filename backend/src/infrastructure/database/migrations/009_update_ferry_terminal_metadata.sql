-- Migration 009: Update ferry terminal metadata
-- Purpose: Set metadata.type = 'ferry_terminal' for stop-027 and stop-028

UPDATE stops
SET metadata = jsonb_build_object('type', 'ferry_terminal')
WHERE id = 'stop-027' AND (metadata IS NULL OR jsonb_typeof(metadata) = 'object');

UPDATE stops
SET metadata = jsonb_build_object('type', 'ferry_terminal')
WHERE id = 'stop-028' AND (metadata IS NULL OR jsonb_typeof(metadata) = 'object');

