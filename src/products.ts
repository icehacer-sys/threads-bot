// Product catalog for the RARE promo reply. Every entry is owner-maintained; the model only ever
// picks a `tag` — the URL comes from THIS file (never model-generated, so no hallucinated links).
// An empty or missing data/products.json leaves the feature inert (the classifier can only pick "none").
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export interface Product {
  tag: string; // slug the classifier emits (free_pack / complete_collection / ...)
  name: string;
  url: string; // appended by CODE after sanitize — the model never writes URLs
  price: string;
  when: string; // shown to the model so it can match product to moment
}

function loadProducts(): Product[] {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const arr = JSON.parse(readFileSync(join(here, "..", "data", "products.json"), "utf8"));
    return Array.isArray(arr) ? (arr as Product[]) : [];
  } catch {
    return []; // no / invalid file -> feature inert
  }
}

export const PRODUCTS = loadProducts();

// Tags the classifier may emit, "none" first. Computed ONCE at load so the reply tool schema
// (and with it the cached prompt prefix) stays identical across a run.
export const PROMO_TAGS: string[] = ["none", ...PRODUCTS.map((p) => p.tag)];

export function getProduct(tag: string | undefined): Product | null {
  if (!tag || tag === "none") return null;
  return PRODUCTS.find((p) => p.tag === tag) ?? null;
}

/** Catalog block injected into the cached system prompt so the model can match product to moment. */
export const PRODUCTS_BLOCK = PRODUCTS.length
  ? `\n\n## YOUR PRODUCT CATALOG (for the rare promo_product plug — pick by fit, never by price)\n${PRODUCTS.map(
      (p) => `- ${p.tag}: ${p.name} (${p.price}). ${p.when}`,
    ).join("\n")}`
  : "";
