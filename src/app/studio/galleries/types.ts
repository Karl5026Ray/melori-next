// Shared types for the /studio/galleries admin UI.

export interface GalleryListItem {
  id: string;
  name: string;
  slug: string;
  clientName: string | null;
  coverUrl: string | null;
  hasPassword: boolean;
  allowDownloads: boolean;
  isActive: boolean;
  viewCount: number;
  createdAt: string;
  imageCount: number;
}

export interface GalleryFolderItem {
  id: string;
  name: string;
  coverPhotoId: string | null;
}

export interface GalleryImageItem {
  id: string;
  folderId: string | null;
  previewUrl: string;
  thumbnailUrl: string;
  caption: string | null;
  filename: string | null;
  forSale: boolean;
  priceCents: number | null;
  orderIndex: number;
}
