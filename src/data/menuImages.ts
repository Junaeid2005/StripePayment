import heroBistroImg from '../assets/images/hero_artisan_bistro_1793195075942.jpg';
import brownieImg from '../assets/images/item_sea_salt_brownie_1793195075857.jpg';
import croissantImg from '../assets/images/item_butter_croissant_1793195077238.jpg';
import chaiImg from '../assets/images/item_cardamom_chai_1793195078640.jpg';
import toastieImg from '../assets/images/item_sourdough_toastie_1793195079985.jpg';
import flatbreadImg from '../assets/images/item_halloumi_flatbread_1793195079971.jpg';
import { DEFAULT_CATALOG_ITEMS, type CatalogSeedItem } from '../shared/catalogData';

export const HERO_BISTRO_IMAGE = heroBistroImg;

export const IMAGE_PRESET_MAP: Record<CatalogSeedItem['imageKey'], string> = {
  brownie: brownieImg,
  croissant: croissantImg,
  chai: chaiImg,
  toastie: toastieImg,
  flatbread: flatbreadImg,
};

export const ADMIN_IMAGE_PRESETS = [
  { label: 'Sea Salt Dark Brownie', value: 'preset:brownie', previewUrl: brownieImg },
  { label: 'All-Butter Croissant', value: 'preset:croissant', previewUrl: croissantImg },
  { label: 'Spiced Cardamom Chai', value: 'preset:chai', previewUrl: chaiImg },
  { label: 'Sourdough Cheddar Toastie', value: 'preset:toastie', previewUrl: toastieImg },
  { label: 'Charred Halloumi Flatbread', value: 'preset:flatbread', previewUrl: flatbreadImg },
];

export function resolveItemImageUrl(rawImageUrl: string): string {
  if (rawImageUrl.startsWith('preset:')) {
    const key = rawImageUrl.slice('preset:'.length) as CatalogSeedItem['imageKey'];
    return IMAGE_PRESET_MAP[key] || flatbreadImg;
  }
  if (rawImageUrl in IMAGE_PRESET_MAP) {
    return IMAGE_PRESET_MAP[rawImageUrl as CatalogSeedItem['imageKey']];
  }
  return rawImageUrl;
}

export function getDefaultMenuDocs() {
  return DEFAULT_CATALOG_ITEMS.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    category: item.category,
    pricePence: item.pricePence,
    imageUrl: `preset:${item.imageKey}`,
    dietaryNote: item.dietaryNote,
    available: item.available,
    sortOrder: item.sortOrder,
  }));
}
