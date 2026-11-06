-- SAMPLEON is now shown as SampAudience. Rename the display name of vendors created by the
-- integration; the vendor code (vid=SAMPLEON) and the integration value stay as they are.
UPDATE "Vendor" SET "name" = 'SampAudience' WHERE "integration" = 'SAMPLEON' AND "name" = 'SAMPLEON';
