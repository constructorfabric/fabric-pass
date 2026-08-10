-- Corrects IDEA-027: verified live against DigitalOcean's real API (the
-- droplet-metrics.ts module doc always flagged this as unconfirmed) that
-- disk_read/disk_write are not droplet monitoring metrics DigitalOcean
-- exposes at all — every call to them 404s. There is no disk I/O figure to
-- show, so the column is dropped rather than kept always-null.
ALTER TABLE droplet_metrics DROP COLUMN disk_io_bytes_per_sec;
