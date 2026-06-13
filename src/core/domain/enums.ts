export type AssetType = 'text' | 'image' | 'video';

export type AssetRole = 'input' | 'input_reference' | 'negative' | 'output';

export type DownloadStatus =
  | 'not_required'
  | 'pending'
  | 'downloading'
  | 'completed'
  | 'failed';

export type DeleteStatus =
  | 'not_deleted'
  | 'deleted'
  | 'file_not_found'
  | 'delete_failed';

export const ASSET_ROLES: AssetRole[] = [
  'input',
  'input_reference',
  'negative',
  'output',
];

export const ROLE_LABELS: Record<AssetRole, string> = {
  input: 'Input',
  input_reference: 'Input Reference',
  negative: 'Negative',
  output: 'Output',
};

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  text: 'Text',
  image: 'Image',
  video: 'Video',
};
