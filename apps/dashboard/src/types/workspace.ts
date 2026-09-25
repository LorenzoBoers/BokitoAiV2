/**
 * Workspace, role, and validation shapes shared across the dashboard.
 *
 * These used to live in `types/custom-db.ts` next to the retired custom-table
 * builder, which they never had anything to do with.
 */

import type { MessengerAppearance } from '../lib/messenger-appearance';

// Canonical workspace roles mirror the backend membership roles.
export const USER_ROLES = ['owner', 'admin', 'member'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const PERMISSION_ACTIONS = [
  'delete_workspace',
  'invite_members',
] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export interface Workspace {
  id: number | string;
  slug?: string;
  name: string;
  timezone?: string;
  logo?: string | null;
  favicon?: string | null;
  brand_color?: string;
  /** Parsed from livechat_settings.appearance (+ legacy keys). */
  messengerAppearance?: MessengerAppearance;
  /** Tenant security: enforce 2FA for all members. */
  require_2fa?: boolean;
  /** Tenant security: Bokito operators may enter this workspace. Default true. */
  allow_platform_support?: boolean;
  owner_user_id?: number | string | null;
  role?: UserRole | 'member';
  created_at?: string;
  updated_at?: string;
}

export interface WorkspaceInvite {
  id: number | string;
  email: string;
  role: UserRole | 'member';
  invited_by_name?: string;
  invited_by?: string;
  invited_at?: string | null;
  expires_at?: string | null;
  status?: 'pending' | 'accepted' | 'revoked' | 'expired';
}

export interface ValidationError {
  fieldSlug: string;
  message: string;
  type: 'required' | 'format' | 'range' | 'unique' | 'custom';
}
