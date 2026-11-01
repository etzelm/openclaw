-- pg_restore flattens the BETWEEN-derived nested AND; re-create it from the schema source text.
ALTER TABLE restore_0f8f2eeae0994803b2000caa81bce35a.worker_session_placement_moves DROP CONSTRAINT worker_session_placement_moves_source_environment_id_check;
ALTER TABLE restore_0f8f2eeae0994803b2000caa81bce35a.worker_session_placement_moves ADD CONSTRAINT worker_session_placement_moves_source_environment_id_check CHECK (char_length(source_environment_id) BETWEEN 1 AND 256 AND source_environment_id = btrim(source_environment_id));
-- main adds this nullable column under the same state schema version (36)
ALTER TABLE restore_0f8f2eeae0994803b2000caa81bce35a.worker_environments ADD COLUMN resource_receipt_json TEXT;
