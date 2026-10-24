/**
 * Feature flags. Build-time (NEXT_PUBLIC_*), so switching one is a redeploy, not a code change.
 */

/**
 * KAN-45 experiment: item actions in a context menu (right-click, or the "⋯" button) instead of the action bar that
 * appears on left-click. Roll back with NEXT_PUBLIC_ITEM_ACTIONS=toolbar.
 */
export const ITEM_MENU = process.env.NEXT_PUBLIC_ITEM_ACTIONS !== 'toolbar';
