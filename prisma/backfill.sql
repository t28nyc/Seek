-- Runs after `prisma db push` on every build. Every statement is safe to repeat.

-- Shop domain (without www.) for listings saved before the column existed.
UPDATE "TrackedUrl"
SET host = lower(regexp_replace(split_part(split_part(url, '://', 2), '/', 1), '^www\.', ''))
WHERE host IS NULL;

-- Chinese products saved before Chinese had its own language.
UPDATE "Product" p
SET language = 'ZH'
WHERE p.language = 'OTHER'
  AND EXISTS (
    SELECT 1 FROM "TrackedUrl" t
    WHERE t."productId" = p.id
      AND t.title ~* '(chinese|simplified|s-chinese|t-chinese|\mchn\M|\mcn\M|gem pack)'
  );
