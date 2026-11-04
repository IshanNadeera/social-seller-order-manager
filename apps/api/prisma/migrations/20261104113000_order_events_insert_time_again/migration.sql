-- 20261104080243_migration was generated from a schema.prisma that an editor had reverted, and put
-- the default back to CURRENT_TIMESTAMP (= now(), the transaction's start). That made events written
-- in one transaction share a timestamp and come back in random order. Set it to clock_timestamp()
-- again, matching schema.prisma (see 20261104080000_order_events_insert_time).
ALTER TABLE "app"."order_events" ALTER COLUMN "created_at" SET DEFAULT clock_timestamp();
