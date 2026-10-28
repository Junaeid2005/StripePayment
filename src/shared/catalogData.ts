export type MenuCategory = 'Bites' | 'Bakery' | 'Drinks' | 'Sweets';

export interface CatalogSeedItem {
  id: string;
  name: string;
  description: string;
  category: MenuCategory;
  pricePence: number;
  imageKey: 'brownie' | 'croissant' | 'chai' | 'toastie' | 'flatbread';
  dietaryNote: string;
  available: boolean;
  sortOrder: number;
}

export const PRIMARY_ADMIN_EMAIL = 'junaeidshohan2005@gmail.com';

export const DEFAULT_CATALOG_ITEMS: CatalogSeedItem[] = [
  {
    id: 'sea-salt-brownie',
    name: 'Maldon Sea Salt Dark Brownie',
    description: 'Single-origin 70% dark Belgian chocolate square baked fudgy and finished with flaky Maldon sea salt.',
    category: 'Sweets',
    pricePence: 100, // £1.00
    imageKey: 'brownie',
    dietaryNote: 'Vegetarian',
    available: true,
    sortOrder: 1,
  },
  {
    id: 'butter-croissant',
    name: 'All-Butter Laminated Croissant',
    description: 'Slow-fermented 48-hour French cultured butter pastry baked golden with crisp honeycomb layers.',
    category: 'Bakery',
    pricePence: 200, // £2.00
    imageKey: 'croissant',
    dietaryNote: 'Vegetarian · Baked Morning',
    available: true,
    sortOrder: 2,
  },
  {
    id: 'spiced-cardamom-chai',
    name: 'Spiced Cardamom Masala Chai',
    description: 'Assam black tea simmered with crushed green cardamom, cinnamon bark, star anise, and velvety steamed milk.',
    category: 'Drinks',
    pricePence: 300, // £3.00
    imageKey: 'chai',
    dietaryNote: 'Vegetarian · Oat Option',
    available: true,
    sortOrder: 3,
  },
  {
    id: 'cheddar-sourdough-toastie',
    name: 'Aged Cheddar Sourdough Toastie',
    description: 'Country levain grilled crisp in cultured butter with 18-month Somerset cheddar and slow-caramelized onion.',
    category: 'Bites',
    pricePence: 400, // £4.00
    imageKey: 'toastie',
    dietaryNote: 'Vegetarian · Served Hot',
    available: true,
    sortOrder: 4,
  },
  {
    id: 'halloumi-pomegranate-flatbread',
    name: 'Charred Halloumi & Pomegranate Flatbread',
    description: 'Stone-baked artisan flatbread topped with golden seared halloumi, ruby pomegranate, fresh mint, and tahini.',
    category: 'Bites',
    pricePence: 500, // £5.00
    imageKey: 'flatbread',
    dietaryNote: 'Vegetarian · House Signature',
    available: true,
    sortOrder: 5,
  },
];

export function formatGBP(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}
