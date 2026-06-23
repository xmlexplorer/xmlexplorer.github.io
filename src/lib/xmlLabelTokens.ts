import type { NodeType } from './tauri';

export type XmlLabelTokenKind = 'delimiter' | 'tagName' | 'attrName' | 'attrValue' | 'comment' | 'text';

export interface XmlLabelToken {
  text: string;
  kind: XmlLabelTokenKind;
}

const ATTR_RE = /(\s+)([^\s=]+)(=")([^"]*)(")/g;

// Splits a tree row's label into syntax-highlightable pieces. Mirrors
// build_label (native/src/tree.rs) exactly rather than guessing from the
// label's shape, since that's the one place the format is defined:
//   - element: `<name attr="value" ...>` or `<name attr="value" .../>`
//   - comment: `<!--content -->`
//   - everything else (text, cdata, pi, document, other): the raw content, as
//     a single token.
export function tokenizeXmlLabel(label: string, nodeType: NodeType): XmlLabelToken[] {
  if (nodeType === 'comment') {
    return [{ text: label, kind: 'comment' }];
  }
  if (nodeType !== 'element') {
    return [{ text: label, kind: 'text' }];
  }

  const closeMatch = /\/?>$/.exec(label);
  const close = closeMatch ? closeMatch[0] : '';
  const body = close ? label.slice(0, label.length - close.length) : label;
  const tagMatch = /^<(\S+)/.exec(body);
  if (!tagMatch) {
    // Doesn't match build_label's element format -- degrade to plain text
    // rather than render a misleading partial tag.
    return [{ text: label, kind: 'text' }];
  }

  const tagName = tagMatch[1];
  const tokens: XmlLabelToken[] = [
    { text: '<', kind: 'delimiter' },
    { text: tagName, kind: 'tagName' },
  ];

  const attrsPortion = body.slice(1 + tagName.length);
  let lastIndex = 0;
  for (const match of attrsPortion.matchAll(ATTR_RE)) {
    tokens.push({ text: match[1], kind: 'text' });
    tokens.push({ text: match[2], kind: 'attrName' });
    tokens.push({ text: match[3], kind: 'delimiter' });
    tokens.push({ text: match[4], kind: 'attrValue' });
    tokens.push({ text: match[5], kind: 'delimiter' });
    lastIndex = (match.index ?? 0) + match[0].length;
  }
  // Normally nothing, but anything between the last attribute and the
  // closing delimiter is preserved rather than silently dropped.
  if (lastIndex < attrsPortion.length) {
    tokens.push({ text: attrsPortion.slice(lastIndex), kind: 'text' });
  }
  tokens.push({ text: close, kind: 'delimiter' });
  return tokens;
}
