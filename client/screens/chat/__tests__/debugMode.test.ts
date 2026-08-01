/**
 * EM-46: Debug Mode Tests
 */

import { checkDebugParam } from '../utils/debugMode';

describe('EM-46: Debug Mode - checkDebugParam', () => {
  test('default URL returns false', () => {
    expect(checkDebugParam('web', '')).toBe(false);
  });

  test('?debug=false returns false', () => {
    expect(checkDebugParam('web', '?debug=false')).toBe(false);
  });

  test('?debug=true returns true', () => {
    expect(checkDebugParam('web', '?debug=true')).toBe(true);
  });

  test('?debug=1 returns false', () => {
    expect(checkDebugParam('web', '?debug=1')).toBe(false);
  });

  test('?debug=yes returns false', () => {
    expect(checkDebugParam('web', '?debug=yes')).toBe(false);
  });

  test('?debug=True returns false (case-sensitive)', () => {
    expect(checkDebugParam('web', '?debug=True')).toBe(false);
  });

  test('?debug=TRUE returns false (case-sensitive)', () => {
    expect(checkDebugParam('web', '?debug=TRUE')).toBe(false);
  });

  test('?debug= returns false', () => {
    expect(checkDebugParam('web', '?debug=')).toBe(false);
  });

  test('non-web platform returns false even with ?debug=true', () => {
    expect(checkDebugParam('ios', '?debug=true')).toBe(false);
    expect(checkDebugParam('android', '?debug=true')).toBe(false);
  });

  test('non-web platform does not throw', () => {
    expect(() => checkDebugParam('ios', '?debug=true')).not.toThrow();
    expect(() => checkDebugParam('android', '')).not.toThrow();
  });

  test('full URL search with multiple params', () => {
    expect(checkDebugParam('web', '?foo=bar&debug=true&baz=1')).toBe(true);
    expect(checkDebugParam('web', '?foo=bar&debug=false&baz=1')).toBe(false);
  });
});

describe('EM-46: ChangeSystemCard rendering condition', () => {
  // The rendering condition in index.tsx is:
  //   {debugMode && <ChangeSystemCard data={changeSystemData} />}
  // where debugMode = isDebugModeEnabled() = checkDebugParam(Platform.OS, window.location.search)
  // So ChangeSystemCard renders only when checkDebugParam returns true.

  function shouldRenderChangeSystemCard(platform: string, search: string, hasFlowContext: boolean): boolean {
    const debugMode = checkDebugParam(platform, search);
    return debugMode && hasFlowContext;
  }

  test('default mode hides ChangeSystemCard', () => {
    expect(shouldRenderChangeSystemCard('web', '', true)).toBe(false);
  });

  test('?debug=false hides ChangeSystemCard', () => {
    expect(shouldRenderChangeSystemCard('web', '?debug=false', true)).toBe(false);
  });

  test('?debug=true shows ChangeSystemCard (when data available)', () => {
    expect(shouldRenderChangeSystemCard('web', '?debug=true', true)).toBe(true);
  });

  test('non-web hides ChangeSystemCard even with ?debug=true', () => {
    expect(shouldRenderChangeSystemCard('ios', '?debug=true', true)).toBe(false);
  });
});
