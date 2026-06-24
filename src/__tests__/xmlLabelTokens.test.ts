import { describe, expect, it } from 'vitest';
import { tokenizeXmlLabel } from '../lib/xmlLabelTokens';

describe('tokenizeXmlLabel', () => {
  it('tokenizes a self-closing element with no attributes', () => {
    expect(tokenizeXmlLabel('<cover/>', 'element')).toEqual([
      { text: '<', kind: 'delimiter' },
      { text: 'cover', kind: 'tagName' },
      { text: '/>', kind: 'delimiter' },
    ]);
  });

  it('tokenizes an expandable element with no attributes', () => {
    expect(tokenizeXmlLabel('<book>', 'element')).toEqual([
      { text: '<', kind: 'delimiter' },
      { text: 'book', kind: 'tagName' },
      { text: '>', kind: 'delimiter' },
    ]);
  });

  it('tokenizes an element with one attribute', () => {
    expect(tokenizeXmlLabel('<book id="1">', 'element')).toEqual([
      { text: '<', kind: 'delimiter' },
      { text: 'book', kind: 'tagName' },
      { text: ' ', kind: 'text' },
      { text: 'id', kind: 'attrName' },
      { text: '="', kind: 'delimiter' },
      { text: '1', kind: 'attrValue' },
      { text: '"', kind: 'delimiter' },
      { text: '>', kind: 'delimiter' },
    ]);
  });

  it('tokenizes a self-closing element with multiple attributes', () => {
    expect(tokenizeXmlLabel('<book id="1" lang="en"/>', 'element')).toEqual([
      { text: '<', kind: 'delimiter' },
      { text: 'book', kind: 'tagName' },
      { text: ' ', kind: 'text' },
      { text: 'id', kind: 'attrName' },
      { text: '="', kind: 'delimiter' },
      { text: '1', kind: 'attrValue' },
      { text: '"', kind: 'delimiter' },
      { text: ' ', kind: 'text' },
      { text: 'lang', kind: 'attrName' },
      { text: '="', kind: 'delimiter' },
      { text: 'en', kind: 'attrValue' },
      { text: '"', kind: 'delimiter' },
      { text: '/>', kind: 'delimiter' },
    ]);
  });

  it('treats a comment as a single token', () => {
    expect(tokenizeXmlLabel('<!--a note -->', 'comment')).toEqual([
      { text: '<!--a note -->', kind: 'comment' },
    ]);
  });

  it.each(['text', 'cdata', 'pi', 'document', 'other'] as const)(
    'treats %s nodes as a single plain-text token',
    (nodeType) => {
      expect(tokenizeXmlLabel('some content', nodeType)).toEqual([
        { text: 'some content', kind: 'text' },
      ]);
    },
  );

  it('degrades to plain text for an element label that does not match the expected shape', () => {
    expect(tokenizeXmlLabel('not-a-tag', 'element')).toEqual([{ text: 'not-a-tag', kind: 'text' }]);
  });
});
