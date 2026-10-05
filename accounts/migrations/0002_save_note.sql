-- Private personal note on a saved restaurant. Empty string means no note.
-- Run once. A second run reports: duplicate column name: note
ALTER TABLE saves ADD COLUMN note TEXT NOT NULL DEFAULT '';
