import type { CurrencyCode } from '@/lib/money';

export interface Money {
  amount: number;
  currency: CurrencyCode;
}

export interface PriceDTO {
  price: Money;
  compareAt: Money | null;
  usdCents: number;
  promotion: { endsAt: string; badge: string | null } | null;
}

export interface ImageDTO {
  url: string;
  alt: string;
  width: number;
  height: number;
  blurDataUrl: string | null;
}

export type Availability = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export interface ProductCardDTO {
  id: string;
  slug: string;
  name: string;
  brand: { name: string; slug: string } | null;
  category: { slug: string; path: string; name: string };
  image: ImageDTO | null;
  price: PriceDTO;
  ratingAvg: number;
  ratingCount: number;
  availability: Availability;
  defaultVariantId: string;
  isNew: boolean;
  hasOfficialWarranty: boolean;
}

export interface VariantOption {
  key: string;
  value: string;
  label: string;
}

export interface VariantDTO {
  id: string;
  sku: string;
  options: VariantOption[];
  price: PriceDTO;
  availability: Availability;
  availableQty: number;
  images: ImageDTO[];
  isDefault: boolean;
}

export interface SpecRowDTO {
  key: string;
  label: string;
  value: string;
  comparable: boolean;
}
export interface SpecGroupDTO {
  group: string;
  rows: SpecRowDTO[];
}

export interface OptionAxisDTO {
  key: string;
  label: string;
  values: { value: string; label: string }[];
}

export type ProductDetailDTO = ProductCardDTO & {
  shortDescription: string | null;
  /** Markdown source. Named `descriptionHtml` by 04 §2; rendered only through <Markdown> (11 §3). */
  descriptionHtml: string | null;
  warrantyMonths: number;
  images: ImageDTO[];
  variants: VariantDTO[];
  optionAxes: OptionAxisDTO[];
  specs: SpecGroupDTO[];
  breadcrumbs: { name: string; href: string }[];
  seo: { title: string; description: string };
};

export type FacetType = 'SELECT' | 'MULTI' | 'NUMBER' | 'BOOLEAN' | 'BRAND' | 'PRICE' | 'AVAILABILITY';

export interface FacetDTO {
  key: string;
  label: string;
  type: FacetType;
  options?: { value: string; label: string; count: number; selected: boolean }[];
  range?: { min: number; max: number; selectedMin?: number; selectedMax?: number; unit?: string };
}

export type SortKey = 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'rating' | 'bestselling';

export interface ListingDTO {
  items: ProductCardDTO[];
  total: number;
  page: number;
  pageSize: 24;
  facets: FacetDTO[];
  sort: SortKey;
  appliedFilters: { key: string; value: string; label: string }[];
}

export interface ListingParams {
  categoryPath?: string;
  brandSlug?: string;
  q?: string;
  sort: SortKey;
  page: number;
  filters: Record<string, string[]>;
  /** Display-currency major units as typed by the customer; converted to USD cents in listProducts. */
  priceMin?: number;
  priceMax?: number;
  inStock?: boolean;
}

/** Unchanged from Phase 0. */
export interface CategoryNodeDTO {
  id: string;
  slug: string;
  path: string;
  name: string;
  iconName: string | null;
  children: CategoryNodeDTO[];
}

export interface CategoryDTO {
  id: string;
  slug: string;
  path: string;
  depth: number;
  name: string;
  description: string | null;
  image: ImageDTO | null;
  children: { slug: string; path: string; name: string }[];
  breadcrumbs: { name: string; href: string }[];
  seo: { title: string; description: string };
}

export interface BrandDTO {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logo: ImageDTO | null;
  websiteUrl: string | null;
  seo: { title: string; description: string };
}

export interface CompareRowDTO {
  key: string;
  label: string;
  unit: string | null;
  values: (string | null)[];
  allEqual: boolean;
}

export interface CompareDTO {
  products: ProductCardDTO[];
  categoryName: string;
  rows: CompareRowDTO[];
}

export interface SuggestDTO {
  products: { slug: string; name: string; image: ImageDTO | null; price: PriceDTO }[];
  categories: { path: string; name: string }[];
  brands: { slug: string; name: string }[];
}

export interface BannerDTO {
  id: string;
  title: string;
  subtitle: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  image: ImageDTO;
  mobileImage: ImageDTO | null;
}

export interface CollectionDTO {
  slug: string;
  title: string;
  items: ProductCardDTO[];
}

export interface HomeDataDTO {
  banners: BannerDTO[];
  categoryTiles: {
    slug: string;
    path: string;
    name: string;
    iconName: string | null;
    image: ImageDTO | null;
  }[];
  flashSales: ProductCardDTO[];
  flashSaleEndsAt: string | null;
  collections: CollectionDTO[];
  featuredBrands: { slug: string; name: string; logo: ImageDTO | null }[];
  newArrivals: ProductCardDTO[];
}
