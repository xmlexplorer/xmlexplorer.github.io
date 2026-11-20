import { GithubOutlined, HeartOutlined } from '@ant-design/icons';
import { Button, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { openExternal } from '../lib/platform';
import { DONATE_URL, GITHUB_URL } from '../lib/support';

/**
 * The support message followed by Donate / Star on GitHub buttons.
 *
 * onClick rather than href: the native webview ignores target="_blank", so
 * external links have to go through openExternal to reach the system browser.
 */
export function SupportLinks({ size = 'middle' }: { size?: 'small' | 'middle' }) {
  const { t } = useTranslation();

  return (
    <Space wrap size="small" align="center">
      <span>{t('support_message')}</span>
      <Space.Compact>
        <Button size={size} icon={<HeartOutlined />} onClick={() => openExternal(DONATE_URL)}>
          {t('donate')}
        </Button>
        <Button size={size} icon={<GithubOutlined />} onClick={() => openExternal(GITHUB_URL)}>
          {t('star_on_github')}
        </Button>
      </Space.Compact>
    </Space>
  );
}
