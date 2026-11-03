export interface CategoryNodeDTO {
  id: string;
  slug: string;
  path: string;
  name: string;
  iconName: string | null;
  children: CategoryNodeDTO[];
}
