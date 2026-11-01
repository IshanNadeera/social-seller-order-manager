-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "app";

-- CreateEnum
CREATE TYPE "app"."member_role" AS ENUM ('OWNER', 'STAFF');

-- CreateEnum
CREATE TYPE "app"."source_channel" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'WHATSAPP', 'PHONE', 'WALK_IN', 'WEBSITE', 'OTHER');

-- CreateEnum
CREATE TYPE "app"."fulfilment_type" AS ENUM ('DELIVERY', 'PICKUP');

-- CreateEnum
CREATE TYPE "app"."order_status" AS ENUM ('NEW', 'PENDING_CONFIRMATION', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED', 'RETURNED');

-- CreateEnum
CREATE TYPE "app"."payment_status" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "app"."payment_method" AS ENUM ('CASH', 'BANK_TRANSFER', 'COD', 'OTHER');

-- CreateEnum
CREATE TYPE "app"."payment_type" AS ENUM ('PAYMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "app"."delivery_status" AS ENUM ('PENDING', 'DISPATCHED', 'DELIVERED', 'FAILED', 'RETURNED');

-- CreateEnum
CREATE TYPE "app"."cod_status" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'COLLECTED', 'SETTLED');

-- CreateEnum
CREATE TYPE "app"."order_event_type" AS ENUM ('ORDER_CREATED', 'ORDER_UPDATED', 'ORDER_STATUS_CHANGED', 'DELIVERY_STATUS_CHANGED', 'PAYMENT_RECORDED', 'REFUND_RECORDED', 'COD_STATUS_CHANGED', 'NOTE_ADDED');

-- CreateTable
CREATE TABLE "app"."users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "disabled_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."businesses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "contact_phone" TEXT,
    "order_prefix" VARCHAR(6) NOT NULL DEFAULT 'ORD',
    "currency" CHAR(3) NOT NULL DEFAULT 'LKR',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Colombo',
    "default_delivery_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."business_counters" (
    "business_id" UUID NOT NULL,
    "next_order_seq" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "business_counters_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "app"."business_members" (
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "app"."member_role" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_members_pkey" PRIMARY KEY ("business_id","user_id")
);

-- CreateTable
CREATE TABLE "app"."customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone_display" TEXT,
    "phone_normalized" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."customer_addresses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "label" TEXT,
    "recipient_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address_line_1" TEXT NOT NULL,
    "address_line_2" TEXT,
    "city" TEXT,
    "district" TEXT,
    "postal_code" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "description" TEXT,
    "selling_price" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "customer_id" UUID,
    "source_channel" "app"."source_channel" NOT NULL,
    "source_note" TEXT,
    "fulfilment_type" "app"."fulfilment_type" NOT NULL DEFAULT 'DELIVERY',
    "order_status" "app"."order_status" NOT NULL DEFAULT 'NEW',
    "payment_method" "app"."payment_method" NOT NULL,
    "payment_status" "app"."payment_status" NOT NULL DEFAULT 'UNPAID',
    "currency" CHAR(3) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "delivery_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "amount_paid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amount_refunded" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "customer_name_snapshot" TEXT NOT NULL,
    "customer_phone_snapshot" TEXT,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "completed_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "cancel_reason" TEXT,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID,
    "position" SMALLINT NOT NULL,
    "product_name_snapshot" TEXT NOT NULL,
    "sku_snapshot" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "line_total" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "type" "app"."payment_type" NOT NULL,
    "method" "app"."payment_method" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "refund_of_payment_id" UUID,
    "reference" TEXT,
    "notes" TEXT,
    "recorded_by" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "status" "app"."delivery_status" NOT NULL DEFAULT 'PENDING',
    "recipient_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address_line_1" TEXT NOT NULL,
    "address_line_2" TEXT,
    "city" TEXT,
    "district" TEXT,
    "postal_code" TEXT,
    "source_address_id" UUID,
    "courier_name" TEXT,
    "tracking_number" TEXT,
    "cod_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cod_status" "app"."cod_status" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "cod_settled_at" TIMESTAMPTZ,
    "cod_payment_id" UUID,
    "attempt_count" SMALLINT NOT NULL DEFAULT 0,
    "dispatched_at" TIMESTAMPTZ,
    "delivered_at" TIMESTAMPTZ,
    "failed_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."order_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "type" "app"."order_event_type" NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."idempotency_keys" (
    "business_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" SMALLINT,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("business_id","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "app"."users"("email");

-- CreateIndex
CREATE INDEX "business_members_user_id_idx" ON "app"."business_members"("user_id");

-- CreateIndex
CREATE INDEX "customers_business_id_phone_normalized_idx" ON "app"."customers"("business_id", "phone_normalized");

-- CreateIndex
CREATE INDEX "customers_business_id_name_idx" ON "app"."customers"("business_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "customers_business_id_id_key" ON "app"."customers"("business_id", "id");

-- CreateIndex
CREATE INDEX "customer_addresses_business_id_customer_id_idx" ON "app"."customer_addresses"("business_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_addresses_business_id_id_key" ON "app"."customer_addresses"("business_id", "id");

-- CreateIndex
CREATE INDEX "products_business_id_name_idx" ON "app"."products"("business_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "products_business_id_id_key" ON "app"."products"("business_id", "id");

-- CreateIndex
CREATE INDEX "orders_business_id_created_at_idx" ON "app"."orders"("business_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_business_id_order_status_created_at_idx" ON "app"."orders"("business_id", "order_status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_business_id_payment_status_created_at_idx" ON "app"."orders"("business_id", "payment_status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_business_id_source_channel_created_at_idx" ON "app"."orders"("business_id", "source_channel", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_business_id_customer_id_idx" ON "app"."orders"("business_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_business_id_id_key" ON "app"."orders"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_business_id_order_number_key" ON "app"."orders"("business_id", "order_number");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "app"."order_items"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_business_id_id_key" ON "app"."order_items"("business_id", "id");

-- CreateIndex
CREATE INDEX "payments_business_id_occurred_at_idx" ON "app"."payments"("business_id", "occurred_at");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "app"."payments"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_business_id_id_key" ON "app"."payments"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_order_id_key" ON "app"."deliveries"("order_id");

-- CreateIndex
CREATE INDEX "deliveries_business_id_status_updated_at_idx" ON "app"."deliveries"("business_id", "status", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "deliveries_business_id_cod_status_idx" ON "app"."deliveries"("business_id", "cod_status");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_business_id_id_key" ON "app"."deliveries"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_business_id_order_id_key" ON "app"."deliveries"("business_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_business_id_cod_payment_id_key" ON "app"."deliveries"("business_id", "cod_payment_id");

-- CreateIndex
CREATE INDEX "order_events_order_id_created_at_idx" ON "app"."order_events"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_events_business_id_id_key" ON "app"."order_events"("business_id", "id");

-- AddForeignKey
ALTER TABLE "app"."business_counters" ADD CONSTRAINT "business_counters_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "app"."businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."business_members" ADD CONSTRAINT "business_members_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "app"."businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."business_members" ADD CONSTRAINT "business_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."customers" ADD CONSTRAINT "customers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "app"."businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."customer_addresses" ADD CONSTRAINT "customer_addresses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "app"."businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."customer_addresses" ADD CONSTRAINT "customer_addresses_business_id_customer_id_fkey" FOREIGN KEY ("business_id", "customer_id") REFERENCES "app"."customers"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."products" ADD CONSTRAINT "products_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "app"."businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "app"."businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_business_id_customer_id_fkey" FOREIGN KEY ("business_id", "customer_id") REFERENCES "app"."customers"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."order_items" ADD CONSTRAINT "order_items_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "app"."businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."order_items" ADD CONSTRAINT "order_items_business_id_order_id_fkey" FOREIGN KEY ("business_id", "order_id") REFERENCES "app"."orders"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."order_items" ADD CONSTRAINT "order_items_business_id_product_id_fkey" FOREIGN KEY ("business_id", "product_id") REFERENCES "app"."products"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "app"."businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_business_id_order_id_fkey" FOREIGN KEY ("business_id", "order_id") REFERENCES "app"."orders"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "app"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_business_id_refund_of_payment_id_fkey" FOREIGN KEY ("business_id", "refund_of_payment_id") REFERENCES "app"."payments"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."deliveries" ADD CONSTRAINT "deliveries_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "app"."businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."deliveries" ADD CONSTRAINT "deliveries_business_id_order_id_fkey" FOREIGN KEY ("business_id", "order_id") REFERENCES "app"."orders"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."deliveries" ADD CONSTRAINT "deliveries_business_id_cod_payment_id_fkey" FOREIGN KEY ("business_id", "cod_payment_id") REFERENCES "app"."payments"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."order_events" ADD CONSTRAINT "order_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "app"."businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."order_events" ADD CONSTRAINT "order_events_business_id_order_id_fkey" FOREIGN KEY ("business_id", "order_id") REFERENCES "app"."orders"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================================
-- Hand-written SQL (docs/DEVELOPMENT.md §8.3, §8.5, ADR-004). Not generated by Prisma: review
-- any change by hand. Everything above this line was generated from prisma/schema.prisma.
-- =====================================================================================

-- ---------- Extensions ----------
-- Supabase keeps extensions in the `extensions` schema (the Security Advisor flags them in public).
-- Created here if missing so the same migration runs on a plain Postgres (CI, shadow database).
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- ---------- CHECK constraints (§8.2, §8.5) ----------
ALTER TABLE app.businesses   ADD CONSTRAINT businesses_prefix_chk   CHECK (order_prefix ~ '^[A-Z0-9]{2,6}$');
ALTER TABLE app.businesses   ADD CONSTRAINT businesses_fee_chk      CHECK (default_delivery_fee >= 0);
ALTER TABLE app.business_counters ADD CONSTRAINT counters_seq_chk   CHECK (next_order_seq >= 1);
ALTER TABLE app.users        ADD CONSTRAINT users_email_lower_chk   CHECK (email = lower(email));
ALTER TABLE app.products     ADD CONSTRAINT products_price_chk      CHECK (selling_price >= 0);
ALTER TABLE app.order_items  ADD CONSTRAINT items_qty_chk           CHECK (quantity BETWEEN 1 AND 9999);
ALTER TABLE app.order_items  ADD CONSTRAINT items_price_chk         CHECK (unit_price >= 0 AND line_total >= 0);
-- §7.5: line_total = quantity × unit_price (exact: an integer times a 2-decimal amount).
ALTER TABLE app.order_items  ADD CONSTRAINT items_line_total_chk    CHECK (line_total = quantity * unit_price);
ALTER TABLE app.orders       ADD CONSTRAINT orders_discount_chk     CHECK (discount_amount >= 0 AND discount_amount <= subtotal);
ALTER TABLE app.orders       ADD CONSTRAINT orders_amounts_chk      CHECK (delivery_fee >= 0 AND total_amount >= 0);
-- §7.5: total_amount = subtotal − discount_amount + delivery_fee.
ALTER TABLE app.orders       ADD CONSTRAINT orders_total_chk        CHECK (total_amount = subtotal - discount_amount + delivery_fee);
ALTER TABLE app.orders       ADD CONSTRAINT orders_paid_chk         CHECK (amount_refunded >= 0 AND amount_paid >= amount_refunded);
ALTER TABLE app.orders       ADD CONSTRAINT orders_customer_chk     CHECK (customer_id IS NOT NULL OR source_channel = 'WALK_IN');
-- §7.10: an anonymous walk-in sale must be a pickup.
ALTER TABLE app.orders       ADD CONSTRAINT orders_walk_in_chk      CHECK (customer_id IS NOT NULL OR fulfilment_type = 'PICKUP');
-- §7.8: cash on delivery only for delivery orders.
ALTER TABLE app.orders       ADD CONSTRAINT orders_cod_delivery_chk CHECK (payment_method <> 'COD' OR fulfilment_type = 'DELIVERY');
ALTER TABLE app.orders       ADD CONSTRAINT orders_other_note_chk   CHECK (source_channel <> 'OTHER' OR source_note IS NOT NULL);
-- §7.9: source note at most 100 characters.
ALTER TABLE app.orders       ADD CONSTRAINT orders_note_len_chk     CHECK (source_note IS NULL OR char_length(source_note) <= 100);
ALTER TABLE app.payments     ADD CONSTRAINT payments_amount_chk     CHECK (amount > 0);
ALTER TABLE app.payments     ADD CONSTRAINT payments_refund_of_chk  CHECK (refund_of_payment_id IS NULL OR type = 'REFUND');
ALTER TABLE app.deliveries   ADD CONSTRAINT deliveries_cod_chk      CHECK (cod_amount >= 0);
ALTER TABLE app.deliveries   ADD CONSTRAINT deliveries_attempts_chk CHECK (attempt_count >= 0);

-- ---------- Partial unique indexes (§8.2, §8.5) ----------
-- One OWNER per business in the MVP.
CREATE UNIQUE INDEX business_one_owner  ON app.business_members (business_id) WHERE role = 'OWNER';
-- SKU unique among a business's active products; archived products keep theirs.
CREATE UNIQUE INDEX products_sku_unique ON app.products (business_id, sku) WHERE sku IS NOT NULL AND archived_at IS NULL;
-- One active default address per customer.
CREATE UNIQUE INDEX address_one_default ON app.customer_addresses (customer_id) WHERE is_default AND archived_at IS NULL;

-- ---------- Search (§8.2) ----------
CREATE INDEX customers_name_trgm ON app.customers USING gin (name extensions.gin_trgm_ops);

-- ---------- Lock the schema away from Supabase's API roles (§11.3, ADR-004) ----------
-- The API connects as the table owner (the role that runs migrations), which bypasses RLS.
-- anon / authenticated (and service_role, which this app never uses) get nothing. The roles exist
-- on Supabase; on a plain Postgres without them this block skips them (CI creates them first).
REVOKE ALL ON SCHEMA app FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA app FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA app FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM %I', r);
      -- Tables created in app later start without access for these roles too.
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- Enable RLS on every app table with NO policies: anon / authenticated could read nothing even if
-- granted. Re-run this block in any migration that adds a table (CI checks it, task A23).
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'app' LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
