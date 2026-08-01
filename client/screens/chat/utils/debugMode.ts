/**
 * EM-46: Debug Mode URL Parameter Check
 *
 * Pure function for testability + production wrapper for safe environment access.
 */

import { Platform } from 'react-native';

/**
 * Pure function: check if debug mode is enabled given platform and URL search string.
 * Only exact match `debug=true` (case-sensitive) returns true.
 */
export function checkDebugParam(platform: string, search: string): boolean {
  if (platform !== 'web') {
    return false;
  }
  const params = new URLSearchParams(search);
  return params.get('debug') === 'true';
}

/**
 * Production wrapper: safely reads Platform.OS and window.location.search.
 */
export function isDebugModeEnabled(): boolean {
  if (typeof window === 'undefined' || typeof Platform === 'undefined') {
    return false;
  }
  const search = window?.location?.search ?? '';
  return checkDebugParam(Platform.OS, search);
}

/**
 * Determine whether the ChangeSystemCard should be rendered.
 * This is the production logic used by index.tsx.
 *
 * @param platform - The platform string (e.g., 'web', 'ios', 'android')
 * @param search - The URL search string (e.g., '?debug=true')
 * @param hasFlowContext - Whether there is flow context data available (null/undefined treated as false)
 * @returns true if ChangeSystemCard should be rendered
 */
export function shouldRenderChangeSystemCard(
  platform: string,
  search: string,
  hasFlowContext: boolean | null | undefined,
): boolean {
  return checkDebugParam(platform, search) && Boolean(hasFlowContext);
}
