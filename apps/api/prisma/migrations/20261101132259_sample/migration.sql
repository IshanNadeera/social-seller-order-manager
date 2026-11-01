-- DropIndex
DROP INDEX "app"."customers_name_trgm";

-- CreateIndex
CREATE INDEX "customers_name_trgm" ON "app"."customers" USING GIN ("name" extensions.gin_trgm_ops);
