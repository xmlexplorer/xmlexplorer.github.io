import { CloseCircleOutlined, WarningOutlined } from '@ant-design/icons';
import { Alert, Button, Drawer, List, Result, Space, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { validateDocument, type ValidationIssue } from '../lib/engine';
import { isDesktop } from '../lib/platform';

// The old Windows marketing/download page; where web users are pointed for the
// desktop app, which is the only build that can do XSD schema validation.
const ABOUT_URL = 'about.html';

interface ValidatePanelProps {
  docId: number;
  // Reveals/selects the issue's node in the tree; absent when the issue has
  // no resolvable node (e.g. "no schema declared", or a schema-file error).
  onLocate: (nodeId: number) => void;
  open: boolean;
  onClose: () => void;
}

export function ValidatePanel({ docId, onLocate, open, onClose }: ValidatePanelProps) {
  const { t } = useTranslation();
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // XSD schema validation is native-only; the browser build can't do it, so the
  // web panel shows an explanatory note with a link to the desktop app instead.
  const web = !isDesktop();

  const runValidation = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      const result = await validateDocument(docId);
      setIssues(result);
    } catch (err) {
      setIssues(null);
      setError(String(err));
    } finally {
      setPending(false);
    }
  }, [docId]);

  // Re-validate each time the drawer is opened -- the document on disk (or its
  // referenced schema) may have changed since the last run. Skipped on the web,
  // which can't validate against a schema at all.
  useEffect(() => {
    if (open && !web) {
      void runValidation();
    }
  }, [open, web, runValidation]);

  const errorCount = issues?.filter((issue) => issue.severity === 'error').length ?? 0;
  const warningCount = issues?.filter((issue) => issue.severity === 'warning').length ?? 0;

  return (
    <Drawer
      mask={false}
      onClose={onClose}
      open={open}
      placement="right"
      styles={{ wrapper: { width: 440 } }}
      title={t('validate.title')}
      extra={
        web ? undefined : (
          <Button size="small" loading={pending} onClick={() => void runValidation()}>
            {t('validate.revalidate')}
          </Button>
        )
      }
    >
      {web && (
        <Alert
          type="info"
          showIcon
          description={
            <>
              {t('validate.web_note')}{' '}
              <a href={ABOUT_URL} target="_blank" rel="noopener noreferrer">
                {t('validate.web_note_link')}
              </a>
            </>
          }
        />
      )}

      {error && (
        <Alert
          type="error"
          showIcon
          title={t('validate.failed_title')}
          description={error}
        />
      )}

      {!error && issues && issues.length === 0 && (
        <Result status="success" title={t('validate.valid_title')} />
      )}

      {!error && issues && issues.length > 0 && (
        <>
          <Typography.Text type="secondary">
            {[
              errorCount > 0 ? t('validate.error_count', { count: errorCount }) : null,
              warningCount > 0 ? t('validate.warning_count', { count: warningCount }) : null,
            ]
              .filter(Boolean)
              .join(', ')}
          </Typography.Text>
          <List
            style={{ marginTop: 8 }}
            size="small"
            dataSource={issues}
            renderItem={(issue, index) => (
              <List.Item
                key={index}
                onClick={issue.nodeId != null ? () => onLocate(issue.nodeId!) : undefined}
                style={issue.nodeId != null ? { cursor: 'pointer' } : undefined}
                title={issue.nodeId != null ? t('tree.show_in_tree') : undefined}
              >
                <Space align="start">
                  <Tag
                    color={issue.severity === 'error' ? 'red' : 'orange'}
                    icon={issue.severity === 'error' ? <CloseCircleOutlined /> : <WarningOutlined />}
                  >
                    {t(`validate.severity.${issue.severity}`)}
                  </Tag>
                  <div>
                    {issue.line != null && (
                      <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                        {issue.col != null
                          ? t('validate.line_col', { line: issue.line, col: issue.col })
                          : t('validate.line_only', { line: issue.line })}
                      </Typography.Text>
                    )}
                    <Typography.Text style={{ whiteSpace: 'pre-wrap' }}>{issue.message}</Typography.Text>
                  </div>
                </Space>
              </List.Item>
            )}
          />
        </>
      )}
    </Drawer>
  );
}
