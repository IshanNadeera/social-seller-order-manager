// Products API requests (docs/DEVELOPMENT.md §6.7, §8.2, §9.3). Used by the API to validate and by
// the web forms (B7), so both apply the same rules and messages. Strict: unknown fields are refused.
import { z } from 'zod';
import {
  changeAtLeastOneField,
  changesSomething,
  optionalText,
  requiredText,
  searchListQueryFields,
} from './common.js';
import { moneySchema } from './money.js';

export const PRODUCT_NAME_MAX_LENGTH = 200;
export const PRODUCT_SKU_MAX_LENGTH = 64;
export const PRODUCT_DESCRIPTION_MAX_LENGTH = 2000;

const productFields = {
  name: requiredText(PRODUCT_NAME_MAX_LENGTH, 'Enter the product name.'),
  /** Kept as typed (trimmed). Unique among the business's active products; blank means none. */
  sku: optionalText(PRODUCT_SKU_MAX_LENGTH),
  description: optionalText(PRODUCT_DESCRIPTION_MAX_LENGTH),
  sellingPrice: moneySchema('Enter the selling price.'),
};

/** POST /products. */
export const productCreateSchema = z.strictObject(productFields);

/** PATCH /products/:id. Send only what changes; null (or "") clears the SKU or description. */
export const productUpdateSchema = z
  .strictObject(productFields)
  .partial()
  .refine(changesSomething, changeAtLeastOneField);

/** GET /products query string (§9.3: search by name or SKU). Values arrive as strings. */
export const productListQuerySchema = z.strictObject(searchListQueryFields);

export type ProductCreateRequest = z.input<typeof productCreateSchema>;
export type ProductCreateInput = z.output<typeof productCreateSchema>;
export type ProductUpdateRequest = z.input<typeof productUpdateSchema>;
export type ProductUpdateInput = z.output<typeof productUpdateSchema>;
export type ProductListQuery = z.output<typeof productListQuerySchema>;
