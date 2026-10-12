// Product catalog for the Weird X-Ray Case Files line (switch day 2026-10-13). Offline: reads files only.
// The model only ever picks a tag; the URL is appended by code from data/products.json, so a stale entry
// here would post a dead or retired link.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { PRODUCTS, PROMO_TAGS, PRODUCTS_BLOCK, getProduct } = await import('../src/products.ts');

const expected: Record<string, string> = {
  free_round: 'https://free.mednoteslab.com/',
  inside_game: 'https://inside.mednoteslab.com/',
  book: 'https://book.mednoteslab.com/',
  every_file: 'https://all.mednoteslab.com/',
  support: 'https://support.mednoteslab.com/',
  anxiety_game: 'https://anxiety.mednoteslab.com/',
};
assert.deepEqual(PRODUCTS.map((p) => p.tag).sort(), Object.keys(expected).sort(), 'catalog tags');
assert.deepEqual(PROMO_TAGS[0], 'none');
for (const [tag, url] of Object.entries(expected)) assert.equal(getProduct(tag)?.url, url, `${tag} url`);

// Retired products, old subdomains and the old discount code must not reach the model or a reply.
const RETIRED = /\b(?:free_pack|complete_collection|could_you_spot_it|volume_[123]|rarest_findings|hopital_edition|viral_10|spotit)\b|\b(?:spot|xray[23]?|rare|hopital|challenge|viral|ctvol1|field|dental)\.mednoteslab\.com|\/l\/collection|hopital pack|complete collection|could you spot it/i;
const promoDescription = readFileSync(new URL('../src/reply.ts', import.meta.url), 'utf8').match(/promo_product: \{[\s\S]*?\n {4}\},/)?.[0] ?? '';
assert.ok(promoDescription.length > 200, 'found the promo_product schema in reply.ts');
for (const [name, text] of [['data/products.json', readFileSync(new URL('../data/products.json', import.meta.url), 'utf8')], ['catalog block', PRODUCTS_BLOCK], ['reply.ts promo_product', promoDescription]] as const) {
  assert.equal(text.match(RETIRED)?.[0], undefined, `${name} mentions a retired product`);
}
// Every tag the promo instructions name is a real catalog tag.
for (const tag of promoDescription.match(/\b[a-z]+_[a-z]+\b/g)?.filter((t) => /_(?:round|game|file|pack|collection)$/.test(t)) ?? []) {
  assert.ok(PROMO_TAGS.includes(tag), `reply.ts names unknown tag ${tag}`);
}
assert.match(promoDescription, /free_round is the default/);

// Public-facing fields: the dropped Case File 01 cases and unverifiable counts stay out.
for (const p of PRODUCTS) {
  assert.ok(!/\b(?:padlock|worms?|twin)\b/i.test(`${p.name} ${p.when}`), `${p.tag} names a dropped case`);
  assert.ok(!/\bAI\b/.test(`${p.name} ${p.when}`), `${p.tag} says AI`);
  assert.ok(!/\breal (?:x-?rays?|patients?|ct|films?)\b/i.test(p.when), `${p.tag} claims real patient films`);
}
assert.ok(!/\b\d{2,} cases\b/i.test(getProduct('every_file')!.when), 'no case count on every_file until the archive is audited');
console.log('PASS product catalog: new-line tags and domains, no retired product or code reaches the model; no network');
