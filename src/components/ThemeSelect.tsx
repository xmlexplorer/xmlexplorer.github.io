import { MoonOutlined, SunOutlined, SwapOutlined } from '@ant-design/icons';
import { Radio, Space, Tooltip } from 'antd';
import { use } from 'react';
import { useTranslation } from 'react-i18next';
import { ThemeNameContext, type ThemeNames } from '../hooks/useThemeName';

export default function ThemeSelect() {
  const { t } = useTranslation();
  const themeNames: ThemeNames[] = ['light', 'dark', 'auto'];
  const themeNameContext = use(ThemeNameContext);
  const themeName = themeNameContext?.themeName;
  const setThemeName =
    themeNameContext?.setThemeName ??
    (() => {
      // console.log();
    });

  const autoTitle = t('themes.auto_description');

  return (
    <Space orientation='horizontal'>
      <div>{t('theme')}</div>
      <Radio.Group
        onChange={(e) => {
          if (typeof e.target.value !== 'string') return;
          const key = e.target.value;
          setThemeName(key as ThemeNames);
        }}
        options={themeNames.map((key) => ({
          value: key,
          label: key === 'auto' ?
            <Tooltip title={autoTitle} placement="bottom">
              <SwapOutlined style={{ marginRight: 8 }} />
              {t('themes.auto')}
            </Tooltip>
            : <>
              {
                key === 'light' ? <SunOutlined style={{ marginRight: 8 }} />
                  : <MoonOutlined style={{ marginRight: 8 }} />
              }
              {t(`themes.${key}`)}
            </>
        }))}
        value={themeName}
        optionType="button"
        buttonStyle="solid"
      />
    </Space>
  );
}
