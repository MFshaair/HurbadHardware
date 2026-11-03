CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Immutable wrapper so unaccent can be used in a generated column
CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text AS $$
  SELECT public.unaccent('public.unaccent', $1)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

ALTER TABLE "Product"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', immutable_unaccent(coalesce("name", ''))), 'A') ||
    setweight(to_tsvector('simple', immutable_unaccent(coalesce("sku", ''))), 'A') ||
    setweight(to_tsvector('simple', immutable_unaccent(coalesce("keywords", ''))), 'B')
  ) STORED;

CREATE INDEX product_search_vector_idx ON "Product" USING GIN ("searchVector");
CREATE INDEX product_name_trgm_idx ON "Product" USING GIN ("name" gin_trgm_ops);
CREATE INDEX brand_name_trgm_idx ON "Brand" USING GIN ("name" gin_trgm_ops);
CREATE INDEX category_translation_name_trgm_idx ON "CategoryTranslation" USING GIN ("name" gin_trgm_ops);

ALTER TABLE "InventoryLevel" ADD CONSTRAINT inventory_on_hand_nonneg CHECK ("onHand" >= 0);
ALTER TABLE "Review" ADD CONSTRAINT review_rating_range CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "CartItem" ADD CONSTRAINT cart_item_qty_pos CHECK ("quantity" > 0 AND "quantity" <= 50);
ALTER TABLE "OrderItem" ADD CONSTRAINT order_item_qty_pos CHECK ("quantity" > 0);

CREATE UNIQUE INDEX product_default_variant ON "ProductVariant"("productId") WHERE "isDefault";
CREATE UNIQUE INDEX payment_one_open_per_order ON "Payment"("orderId") WHERE "status" IN ('INITIATED','PENDING');
