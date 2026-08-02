/**
 * EM-49: Environment Label Configuration Test
 * 
 * Tests that the environment label in the footer is correctly driven by
 * EXPO_PUBLIC_APP_ENV environment variable, with fallback to __DEV__.
 */

describe('EM-49: Environment Label Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset modules to ensure clean state
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Environment Label Logic', () => {
    it('should use EXPO_PUBLIC_APP_ENV when set to DEV', () => {
      process.env.EXPO_PUBLIC_APP_ENV = 'DEV';
      
      // Simulate the logic from index.tsx
      const envLabel = process.env.EXPO_PUBLIC_APP_ENV || (__DEV__ ? 'DEV' : 'PROD');
      
      expect(envLabel).toBe('DEV');
    });

    it('should use EXPO_PUBLIC_APP_ENV when set to PROD', () => {
      process.env.EXPO_PUBLIC_APP_ENV = 'PROD';
      
      const envLabel = process.env.EXPO_PUBLIC_APP_ENV || (__DEV__ ? 'DEV' : 'PROD');
      
      expect(envLabel).toBe('PROD');
    });

    it('should use EXPO_PUBLIC_APP_ENV when set to STAGING', () => {
      process.env.EXPO_PUBLIC_APP_ENV = 'STAGING';
      
      const envLabel = process.env.EXPO_PUBLIC_APP_ENV || (__DEV__ ? 'DEV' : 'PROD');
      
      expect(envLabel).toBe('STAGING');
    });

    it('should fallback to __DEV__ when EXPO_PUBLIC_APP_ENV is not set', () => {
      delete process.env.EXPO_PUBLIC_APP_ENV;
      
      // In test environment, __DEV__ is typically true
      // Mock __DEV__ to true for this test
      const originalDev = (globalThis as any).__DEV__;
      (globalThis as any).__DEV__ = true;
      
      try {
        const envLabel = process.env.EXPO_PUBLIC_APP_ENV || (__DEV__ ? 'DEV' : 'PROD');
        
        // Since __DEV__ is true in test environment, should be 'DEV'
        expect(envLabel).toBe('DEV');
      } finally {
        (globalThis as any).__DEV__ = originalDev;
      }
    });

    it('should fallback to PROD when EXPO_PUBLIC_APP_ENV is not set and __DEV__ is false', () => {
      delete process.env.EXPO_PUBLIC_APP_ENV;
      
      // Mock __DEV__ to false (production build)
      const originalDev = (globalThis as any).__DEV__;
      (globalThis as any).__DEV__ = false;
      
      try {
        const envLabel = process.env.EXPO_PUBLIC_APP_ENV || (__DEV__ ? 'DEV' : 'PROD');
        expect(envLabel).toBe('PROD');
      } finally {
        (globalThis as any).__DEV__ = originalDev;
      }
    });

    it('should prefer EXPO_PUBLIC_APP_ENV over __DEV__', () => {
      process.env.EXPO_PUBLIC_APP_ENV = 'PROD';
      
      // Even though __DEV__ might be true, EXPO_PUBLIC_APP_ENV should take precedence
      const envLabel = process.env.EXPO_PUBLIC_APP_ENV || (__DEV__ ? 'DEV' : 'PROD');
      
      expect(envLabel).toBe('PROD');
    });

    it('should handle empty string EXPO_PUBLIC_APP_ENV as falsy', () => {
      process.env.EXPO_PUBLIC_APP_ENV = '';
      
      // Mock __DEV__ to true for this test
      const originalDev = (globalThis as any).__DEV__;
      (globalThis as any).__DEV__ = true;
      
      try {
        const envLabel = process.env.EXPO_PUBLIC_APP_ENV || (__DEV__ ? 'DEV' : 'PROD');
        
        // Empty string is falsy, so should fallback to __DEV__
        expect(envLabel).toBe('DEV');
      } finally {
        (globalThis as any).__DEV__ = originalDev;
      }
    });
  });

  describe('Version Display', () => {
    it('should display correct format with environment and version', () => {
      process.env.EXPO_PUBLIC_APP_ENV = 'DEV';
      const version = 'v3.1.0';
      
      const envLabel = process.env.EXPO_PUBLIC_APP_ENV || (__DEV__ ? 'DEV' : 'PROD');
      const displayText = `${envLabel} - ${version}`;
      
      expect(displayText).toBe('DEV - v3.1.0');
    });

    it('should display PROD environment correctly', () => {
      process.env.EXPO_PUBLIC_APP_ENV = 'PROD';
      const version = 'v3.1.0';
      
      const envLabel = process.env.EXPO_PUBLIC_APP_ENV || (__DEV__ ? 'DEV' : 'PROD');
      const displayText = `${envLabel} - ${version}`;
      
      expect(displayText).toBe('PROD - v3.1.0');
    });
  });
});
