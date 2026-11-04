-- Events written in one transaction all got the same created_at (now() is the transaction's start
-- time), so the activity history could show them out of order. clock_timestamp() is the time of
-- each insert. Existing rows keep their values.
ALTER TABLE "app"."order_events" ALTER COLUMN "created_at" SET DEFAULT clock_timestamp();
