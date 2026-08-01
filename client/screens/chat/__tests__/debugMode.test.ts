/**
 * EM-43 Debug Mode 测试
 * 测试生产代码中的 checkDebugParam 和 shouldRenderChangeSystemCard
 */
import {
  checkDebugParam,
  isDebugModeEnabled,
  shouldRenderChangeSystemCard,
} from '../utils/debugMode';

describe('EM-43: Debug Mode > checkDebugParam (pure function)', () => {
  test('默认 URL 返回 false', () => {
    expect(checkDebugParam('web', '')).toBe(false);
  });

  test('?debug=true 返回 true', () => {
    expect(checkDebugParam('web', '?debug=true')).toBe(true);
  });

  test('?debug=false 返回 false', () => {
    expect(checkDebugParam('web', '?debug=false')).toBe(false);
  });

  test('?debug=1 返回 false', () => {
    expect(checkDebugParam('web', '?debug=1')).toBe(false);
  });

  test('?debug=yes 返回 false', () => {
    expect(checkDebugParam('web', '?debug=yes')).toBe(false);
  });

  test('?debug=True 返回 false（大小写敏感）', () => {
    expect(checkDebugParam('web', '?debug=True')).toBe(false);
  });

  test('?debug=TRUE 返回 false（大小写敏感）', () => {
    expect(checkDebugParam('web', '?debug=TRUE')).toBe(false);
  });

  test('?debug= 返回 false', () => {
    expect(checkDebugParam('web', '?debug=')).toBe(false);
  });

  test('完整 URL search 带多个参数', () => {
    expect(checkDebugParam('web', '?foo=bar&debug=true&baz=qux')).toBe(true);
    expect(checkDebugParam('web', '?foo=bar&debug=false&baz=qux')).toBe(false);
  });
});

describe('EM-43: Debug Mode > platform check', () => {
  test('非 Web 平台返回 false 即使有 ?debug=true', () => {
    expect(checkDebugParam('ios', '?debug=true')).toBe(false);
    expect(checkDebugParam('android', '?debug=true')).toBe(false);
  });
});

describe('EM-43: Debug Mode > shouldRenderChangeSystemCard (production function)', () => {
  test('默认模式隐藏 ChangeSystemCard', () => {
    expect(shouldRenderChangeSystemCard('web', '', true)).toBe(false);
  });

  test('?debug=false 隐藏 ChangeSystemCard', () => {
    expect(shouldRenderChangeSystemCard('web', '?debug=false', true)).toBe(false);
  });

  test('?debug=true 且数据存在时显示 ChangeSystemCard', () => {
    expect(shouldRenderChangeSystemCard('web', '?debug=true', true)).toBe(true);
  });

  test('?debug=true 但数据不存在时隐藏', () => {
    expect(shouldRenderChangeSystemCard('web', '?debug=true', false)).toBe(false);
    expect(shouldRenderChangeSystemCard('web', '?debug=true', null)).toBe(false);
    expect(shouldRenderChangeSystemCard('web', '?debug=true', undefined)).toBe(false);
  });

  test('非 Web 平台隐藏 ChangeSystemCard 即使有 ?debug=true', () => {
    expect(shouldRenderChangeSystemCard('ios', '?debug=true', true)).toBe(false);
    expect(shouldRenderChangeSystemCard('android', '?debug=true', true)).toBe(false);
  });
});

describe('EM-43: Debug Mode > isDebugModeEnabled (wrapper)', () => {
  test('非 Web 环境不报错', () => {
    // 在测试环境中 Platform.OS 可能是 'web'（jest-expo preset）
    // 但这个测试确保函数不会因为 window 不存在而崩溃
    expect(() => isDebugModeEnabled()).not.toThrow();
  });
});
