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
  if (typeof window === 'undefined') {
    return false;
  }
  return checkDebugParam(Platform.OS, window.location.search);
}
