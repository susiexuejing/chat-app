/**
 * EM-46: Debug Mode URL Parameter Check
 * 
 * This module provides a function to check if debug mode should be enabled
 * based on the URL query parameter.
 * 
 * Rules:
 * - Only Web environment
 * - Only ?debug=true (exact match) enables debug mode
 * - ?debug=false, ?debug=1, ?debug=yes, ?debug=True, ?debug=TRUE all return false
 * - Non-Web environment returns false without error
 */

import { Platform } from 'react-native';

/**
 * Check if debug mode should be enabled based on URL query parameter.
 * 
 * @returns true only if:
 * - Platform is Web
 * - window is defined
 * - URL contains ?debug=true (exact match, case-sensitive)
 */
export function isDebugModeEnabled(): boolean {
  // Only check on Web environment
  if (Platform.OS !== 'web') {
    return false;
  }
  
  // Check if window is defined
  if (typeof window === 'undefined') {
    return false;
  }
  
  // Get URL search params
  const params = new URLSearchParams(window.location.search);
  
  // Only exact match 'true' enables debug mode
  return params.get('debug') === 'true';
}
