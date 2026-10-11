-- Runs once, on the first initialization of the PostGIS data volume.
-- Traccar gets its own database so its schema never mixes with the application schema.
-- Plain SQL (not a shell script) so it works regardless of file permissions on bind mounts.
CREATE DATABASE traccar;
