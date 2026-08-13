/**
 * EM-43 Legacy Scripts Regression Tests
 * 
 * Tests that the ID generation patterns used in all 6 legacy scripts
 * comply with the server's ID protocol: /^[a-zA-Z0-9_-]{1,100}$/
 */

import * as fs from 'fs';
import * as path from 'path';

// ID protocol regex (must match server validation)
const ID_PROTOCOL_REGEX = /^[a-zA-Z0-9_-]{1,100}$/;

// Replicate the ID generation pattern used in all scripts
function generateConversationId(): string {
  return `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

describe('EM-43: Legacy Scripts ID Pattern Validation', () => {
  describe('ConversationId pattern (used in all 6 scripts)', () => {
    it('generates valid conversationId matching server protocol', () => {
      const id = generateConversationId();
      expect(id).toMatch(ID_PROTOCOL_REGEX);
    });

    it('conversationId length is within bounds', () => {
      const id = generateConversationId();
      expect(id.length).toBeGreaterThanOrEqual(1);
      expect(id.length).toBeLessThanOrEqual(100);
    });

    it('generates unique conversationIds', () => {
      const ids = new Set([
        generateConversationId(),
        generateConversationId(),
        generateConversationId(),
      ]);
      expect(ids.size).toBe(3);
    });

    it('conversationId starts with conv_ prefix', () => {
      const id = generateConversationId();
      expect(id.startsWith('conv_')).toBe(true);
    });
  });

  describe('RequestId pattern (used in all 6 scripts)', () => {
    it('generates valid requestId matching server protocol', () => {
      const id = generateRequestId();
      expect(id).toMatch(ID_PROTOCOL_REGEX);
    });

    it('requestId length is within bounds', () => {
      const id = generateRequestId();
      expect(id.length).toBeGreaterThanOrEqual(1);
      expect(id.length).toBeLessThanOrEqual(100);
    });

    it('generates unique requestIds', () => {
      const ids = new Set([
        generateRequestId(),
        generateRequestId(),
        generateRequestId(),
      ]);
      expect(ids.size).toBe(3);
    });

    it('requestId starts with req_ prefix', () => {
      const id = generateRequestId();
      expect(id.startsWith('req_')).toBe(true);
    });
  });
});

describe('EM-43: Scripts file content validation', () => {
  const scriptsDir = path.join(__dirname, '../scripts');
  const scriptFiles = [
    'sixPersonalityTest.ts',
    'sixPersonalityTest2.ts',
    'flowProdTest.ts',
    'flowProdTestAA.ts',
    'prodChangeRegression.ts',
    'prodFullTest.ts',
  ];

  scriptFiles.forEach((scriptFile) => {
    describe(scriptFile, () => {
      it('contains conversationId generation', () => {
        const content = fs.readFileSync(path.join(scriptsDir, scriptFile), 'utf-8');
        expect(content).toContain('conversationId');
        expect(content).toContain('conv_');
      });

      it('contains requestId generation', () => {
        const content = fs.readFileSync(path.join(scriptsDir, scriptFile), 'utf-8');
        expect(content).toContain('requestId');
        expect(content).toContain('req_');
      });

      it('includes conversationId in request body', () => {
        const content = fs.readFileSync(path.join(scriptsDir, scriptFile), 'utf-8');
        // Check that conversationId is included in the fetch body
        expect(content).toMatch(/body:\s*JSON\.stringify\([^)]*conversationId/);
      });

      it('includes requestId in request body', () => {
        const content = fs.readFileSync(path.join(scriptsDir, scriptFile), 'utf-8');
        // Check that requestId is included in the fetch body
        expect(content).toMatch(/body:\s*JSON\.stringify\([^)]*requestId/);
      });
    });
  });
});

describe('EM-43: ID Protocol Validation', () => {
  it('rejects IDs longer than 100 characters', () => {
    const longId = 'a'.repeat(101);
    expect(longId).not.toMatch(ID_PROTOCOL_REGEX);
  });

  it('rejects IDs with special characters', () => {
    expect('conv@test').not.toMatch(ID_PROTOCOL_REGEX);
    expect('conv#123').not.toMatch(ID_PROTOCOL_REGEX);
    expect('conv 123').not.toMatch(ID_PROTOCOL_REGEX);
    expect('conv/123').not.toMatch(ID_PROTOCOL_REGEX);
  });

  it('accepts IDs with allowed characters', () => {
    expect('conv_123').toMatch(ID_PROTOCOL_REGEX);
    expect('conv-123').toMatch(ID_PROTOCOL_REGEX);
    expect('CONV_123').toMatch(ID_PROTOCOL_REGEX);
    expect('conv123ABC').toMatch(ID_PROTOCOL_REGEX);
  });

  it('accepts IDs at boundary lengths', () => {
    expect('a').toMatch(ID_PROTOCOL_REGEX); // min length
    expect('a'.repeat(100)).toMatch(ID_PROTOCOL_REGEX); // max length
  });

  it('rejects empty IDs', () => {
    expect('').not.toMatch(ID_PROTOCOL_REGEX);
  });
});
