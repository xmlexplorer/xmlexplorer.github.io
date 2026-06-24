import { Alert, Button, Drawer, Input, List, Space, Tag, Typography } from 'antd';
import { useCallback, useState } from 'react';
import { evaluateXPath, type NodeSummary } from '../lib/tauri';

interface XPathPanelProps {
  docId: number;
  // The context node XPath is evaluated against -- the selected tree node, or the
  // document root when nothing is selected, mirroring the original's behavior.
  contextNodeId: number;
  contextLabel: string;
  // Reveals/selects a matched node in the tree.
  onLocate: (nodeId: number) => void;
  open: boolean;
  onClose: () => void;
}

// What the panel is currently showing. A node-set accumulates across "Load more"
// pages; a scalar (count()/string()/boolean) is a single value.
type View =
  | { kind: 'empty' }
  | { kind: 'scalar'; valueType: string; value: string }
  | { kind: 'nodeset'; items: NodeSummary[]; total: number; loadedThrough: number; hasMore: boolean };

export function XPathPanel({
  docId,
  contextNodeId,
  contextLabel,
  onLocate,
  open,
  onClose,
}: XPathPanelProps) {
  const [expression, setExpression] = useState('');
  // The expression the current results belong to -- paging "Load more" must use
  // this, not whatever's since been typed into the input.
  const [evaluatedExpr, setEvaluatedExpr] = useState('');
  const [view, setView] = useState<View>({ kind: 'empty' });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const evaluate = useCallback(async () => {
    const expr = expression.trim();
    if (!expr) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await evaluateXPath(docId, contextNodeId, expr, 0);
      setEvaluatedExpr(expr);
      if (result.kind === 'scalar') {
        setView({ kind: 'scalar', valueType: result.valueType, value: result.value });
      } else {
        const { items, total, offset, hasMore } = result.page;
        setView({ kind: 'nodeset', items, total, loadedThrough: offset + items.length, hasMore });
      }
    } catch (err) {
      setView({ kind: 'empty' });
      setError(String(err));
    } finally {
      setPending(false);
    }
  }, [docId, contextNodeId, expression]);

  const loadMore = useCallback(async () => {
    if (view.kind !== 'nodeset' || !view.hasMore) {
      return;
    }
    setPending(true);
    try {
      const result = await evaluateXPath(docId, contextNodeId, evaluatedExpr, view.loadedThrough);
      if (result.kind !== 'nodeset') {
        return;
      }
      const { items, total, offset, hasMore } = result.page;
      setView((prev) =>
        prev.kind === 'nodeset'
          ? {
            kind: 'nodeset',
            items: [...prev.items, ...items],
            total,
            loadedThrough: offset + items.length,
            hasMore,
          }
          : prev,
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setPending(false);
    }
  }, [docId, contextNodeId, evaluatedExpr, view]);

  return (
    <Drawer
      mask={false}
      onClose={onClose}
      open={open}
      placement="right"
      styles={{ wrapper: { width: 440 } }}
      title="Evaluate XPath"
    >
      <Space.Compact style={{ width: '100%' }}>
        <Input
          value={expression}
          onChange={(e) => setExpression(e.target.value)}
          onPressEnter={() => void evaluate()}
          placeholder="XPath, e.g. //book[@id='bk101']"
          allowClear
          autoFocus
          style={{ fontFamily: 'monospace' }}
        />
        <Button type="primary" loading={pending} onClick={() => void evaluate()}>
          Evaluate
        </Button>
      </Space.Compact>

      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
        Context:{' '}
        <span style={{ fontFamily: 'monospace' }}>{contextLabel}</span> — select a node in the tree to
        change it.
      </Typography.Text>

      {error && (
        <Alert style={{ marginTop: 12 }} type="error" showIcon title="Invalid expression" description={error} />
      )}

      {view.kind === 'scalar' && (
        <div style={{ marginTop: 16 }}>
          <Space align="center">
            <Tag>{view.valueType}</Tag>
            <Typography.Text strong copyable style={{ fontFamily: 'monospace' }}>
              {view.value}
            </Typography.Text>
          </Space>
        </div>
      )}

      {view.kind === 'nodeset' && (
        <div style={{ marginTop: 16 }}>
          <Typography.Text type="secondary">
            {view.total.toLocaleString()} {view.total === 1 ? 'match' : 'matches'}
          </Typography.Text>
          <List
            size="small"
            dataSource={view.items}
            renderItem={(item) => (
              <List.Item
                onClick={() => onLocate(item.nodeId)}
                style={{ cursor: 'pointer' }}
                title="Show in tree"
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Typography.Text style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                    {item.label}
                  </Typography.Text>
                  {item.value != null && (
                    <Typography.Text
                      type="secondary"
                      style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}
                    >
                      {item.value}
                    </Typography.Text>
                  )}
                </div>
              </List.Item>
            )}
            locale={{ emptyText: 'No matches' }}
          />
          {view.hasMore && (
            <Button block loading={pending} onClick={() => void loadMore()}>
              Load more ({(view.total - view.loadedThrough).toLocaleString()} remaining)
            </Button>
          )}
        </div>
      )}
    </Drawer>
  );
}
