import { describe, expect, it } from 'vitest';
import { baseName } from '../lib/path';

describe('baseName', () => {
  it('returns the final segment of a POSIX path', () => {
    expect(baseName('/Users/jason/catalog.xml')).toBe('catalog.xml');
  });

  it('returns the final segment of a Windows path', () => {
    expect(baseName('C:\\Users\\jason\\catalog.xml')).toBe('catalog.xml');
  });

  it('handles mixed separators', () => {
    expect(baseName('C:/Users\\jason/catalog.xml')).toBe('catalog.xml');
  });

  it('returns the input unchanged when there is no separator', () => {
    expect(baseName('catalog.xml')).toBe('catalog.xml');
  });

  it('returns the input for an empty string', () => {
    expect(baseName('')).toBe('');
  });
});
