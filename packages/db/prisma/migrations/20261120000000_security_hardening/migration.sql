-- Security review findings S4 and S9 (docs/handbook/SECURITY_REVIEW.md).

-- S4: rate-limit counters shared by every API process (THROTTLE_STORE=database), so the limits hold
-- across tasks and autoscaling. One row per throttler, client and route; old rows are swept.
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "hits" INTEGER NOT NULL,
    "windowEnds" TIMESTAMP(3) NOT NULL,
    "blockedUntil" TIMESTAMP(3),

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "RateLimitBucket_windowEnds_idx" ON "RateLimitBucket"("windowEnds");

-- S9: the same tenant-isolation policy as Response and Capture (ADR 0012) on the other tables that
-- hold respondents' or contacts' personal data. Like the existing policy it applies only when a
-- request set app.tenant_id (PrismaService.forTenant); system paths (workers, the interview
-- runtime, migrations) see every row, so this is a second line of defence behind the tenant filters.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['CatiCase', 'CatiCall', 'DoNotCall', 'Contact', 'Invitation', 'BackCheck', 'QualityAppeal'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY zapx_tenant_isolation ON %I '
      'USING (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true)) '
      'WITH CHECK (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true))',
      t);
  END LOOP;
END $$;
