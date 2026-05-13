const qty = 10;
const itemsData = Array.from({ length: Math.floor(qty) }).map(() => ({
  productId: 'some-id',
  warehouseId: 'some-warehouse',
  status: "AVAILABLE",
  updatedAt: new Date(),
}));

console.log("Items Data Length:", itemsData.length);
console.log("First item:", itemsData[0]);
console.log("Last item:", itemsData[itemsData.length - 1]);
