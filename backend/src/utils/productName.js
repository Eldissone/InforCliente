function normalizeProductName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("pt-PT");
}

function normalizeSearchKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function withUppercaseProductName(product) {
  if (!product) return product;
  return { ...product, name: normalizeProductName(product.name) };
}

function productSearchWhere(search) {
  const term = String(search || "").trim();
  if (!term) return {};
  return {
    OR: [
      { name: { contains: term, mode: "insensitive" } },
      { sku: { contains: term, mode: "insensitive" } },
      { aliases: { some: { alias: { contains: term, mode: "insensitive" } } } },
    ],
  };
}

module.exports = {
  normalizeProductName,
  normalizeSearchKey,
  withUppercaseProductName,
  productSearchWhere,
};
