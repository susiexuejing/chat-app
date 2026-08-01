/**
 * EM-43 前端自动化测试
 * 
 * 测试 Debug Mode URL 参数检测
 */

import { isDebugModeEnabled } from '../utils/debugMode';

describe('EM-43: Debug Mode', () => {
  describe('isDebugModeEnabled', () => {
    test('默认 URL 返回 false', () => {
      const result = isDebugModeEnabled('web', 'http://localhost:5000/');
      expect(result).toBe(false);
    });

    test('?debug=false 返回 false', () => {
      const result = isDebugModeEnabled('web', 'http://localhost:5000/?debug=false');
      expect(result).toBe(false);
    });

    test('?debug=true 返回 true', () => {
      const result = isDebugModeEnabled('web', 'http://localhost:5000/?debug=true');
      expect(result).toBe(true);
    });

    test('?debug=1 返回 false', () => {
      const result = isDebugModeEnabled('web', 'http://localhost:5000/?debug=1');
      expect(result).toBe(false);
    });

    test('?debug=yes 返回 false', () => {
      const result = isDebugModeEnabled('web', 'http://localhost:5000/?debug=yes');
      expect(result).toBe(false);
    });

    test('?debug=True 返回 false（大小写敏感）', () => {
      const result = isDebugModeEnabled('web', 'http://localhost:5000/?debug=True');
      expect(result).toBe(false);
    });

    test('?debug=TRUE 返回 false（大小写敏感）', () => {
      const result = isDebugModeEnabled('web', 'http://localhost:5000/?debug=TRUE');
      expect(result).toBe(false);
    });

    test('?debug= 返回 false', () => {
      const result = isDebugModeEnabled('web', 'http://localhost:5000/?debug=');
      expect(result).toBe(false);
    });

    test('非 Web 环境返回 false', () => {
      const result = isDebugModeEnabled('ios', 'http://localhost:5000/?debug=true');
      expect(result).toBe(false);
    });

    test('非 Web 环境不报错', () => {
      expect(() => {
        isDebugModeEnabled('android', 'http://localhost:5000/?debug=true');
      }).not.toThrow();
    });

    test('window 不存在时不报错', () => {
      // 模拟 window 不存在的情况
      const originalWindow = global.window;
      // @ts-ignore
      delete global.window;
      
      expect(() => {
        isDebugModeEnabled('web', 'http://localhost:5000/?debug=true');
      }).not.toThrow();
      
      // 恢复 window
      global.window = originalWindow;
    });
  });
});
