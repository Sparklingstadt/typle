-- 0037_drop_sharing: sharing a pack (/api/shares, /api/shared) and the gallery (/api/gallery and its reports and counts)
-- were removed in v2.49.0; a pack is handed to someone as a CSV or .typle-pack.json file instead. Their tables are
-- dropped: the snapshots of shared packs (the owners keep the packs themselves in their workspaces), the reports, and
-- the rate limit's counts. The app before v2.49.0 still runs on the database without them, except its sharing and
-- gallery, which answer databaseUnavailable.
DROP TABLE IF EXISTS "typle_gallery_reports";
DROP TABLE IF EXISTS "typle_gallery_hits";
DROP TABLE IF EXISTS "typle_shared_packs";
