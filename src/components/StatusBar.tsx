import { GithubOutlined, HeartOutlined } from '@ant-design/icons';
import { Button, Space, theme } from 'antd';
import { useTranslation } from 'react-i18next';
import { openExternal } from '../lib/platform';
import { DONATE_URL, GITHUB_URL } from '../lib/support';
import { FooterAd } from './FooterAd';

interface StatusBarProps {
  /** Changes whenever a document finishes opening (see FooterAd). */
  docLoadCount: number;
}

/**
 * Bottom-of-app status bar: donate/source links, plus an AdSense banner on web
 * (see FooterAd).
 */
export function StatusBar({ docLoadCount }: StatusBarProps) {
  const { t } = useTranslation();

  const {
    token: { colorBgLayout },
  } = theme.useToken();

  return (
    <Space
      size="small"
      orientation="vertical"
      style={{
        width: '100%',
        padding: '4px 16px',
        background: colorBgLayout,
      }}
    >
      <span style={{ flexShrink: 0 }}>
        <Space>
          <Button type="link" size="small" icon={<HeartOutlined />} onClick={() => openExternal(DONATE_URL)}>
            {t('donate')}
          </Button>
          <Button type="link" size="small" icon={<GithubOutlined />} onClick={() => openExternal(GITHUB_URL)}>
            {t('actions.code')}
          </Button>
        </Space>
      </span>
      <FooterAd contentKey={docLoadCount} />
    </Space>
  );
}
