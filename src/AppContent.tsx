import { FileOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons';
import { open } from '@tauri-apps/plugin-dialog';
import { Button, ConfigProvider, Dropdown, Layout, Space, Typography, message, theme } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdBar } from './components/AdBar';
import LanguageDropdown from './components/LanguageDropdown';
import { XmlTree } from './components/XmlTree';
import useThemeMenuItems from './hooks/useThemeMenuItems';
import { ThemeNameContext, useThemeName, type ThemeNames } from './hooks/useThemeName';
import { paintFrame } from './lib/paintFrame';
import { closeDocument, openDocument, type OpenedDocument } from './lib/tauri';

const HEADER_HEIGHT = 'auto';
const AD_HEIGHT = 90;

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function AppContent() {
  const { t } = useTranslation();
  const [doc, setDoc] = useState<OpenedDocument | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  const { defaultAlgorithm, darkAlgorithm } = theme;
  const { token: { colorBgContainer, colorBgBase } } = theme.useToken();

  const { isDarkMode, themeName, setTheme } = useThemeName();
  const themeMenuItems = useThemeMenuItems();
  const updateThemeName = (value: ThemeNames) => {
    setTheme(value);
  };

  useEffect(() => {
    if (!contentRef.current) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      setContentHeight(entries[0].contentRect.height);
    });
    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, []);

  const onOpenFile = useCallback(() => {
    void (async () => {
      const path = await open({
        multiple: false,
        filters: [{ name: 'XML Files', extensions: ['xml'] }],
      });
      if (!path || typeof path !== 'string') {
        return;
      }

      setLoading(true);
      await paintFrame();
      try {
        const opened = await openDocument(path);
        // Free the previous document's parsed tree on the Rust side -- otherwise
        // each opened file leaks for the lifetime of the app.
        if (doc) {
          void closeDocument(doc.docId);
        }
        setDoc(opened);
        setFileName(baseName(path));
      } catch (err) {
        void message.error(String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [doc]);

  return (
    <ConfigProvider
      theme={{
        algorithm: isDarkMode ? darkAlgorithm : defaultAlgorithm
      }}
    >
      <ThemeNameContext
        value={{
          isDarkMode,
          themeName,
          setThemeName: updateThemeName,
        }}
      >
        <Layout style={{ height: '100%' }}>

          <Layout.Header style={{ backgroundColor: colorBgBase, height: 'auto', lineHeight: 'normal', padding: '8px', display: 'flex', alignItems: 'center' }}>

            <Space wrap align="center">
              <span style={{ marginRight: 8, fontFamily: 'inherit' }}>XML Explorer</span>

              <Button onClick={onOpenFile} loading={loading} icon={<FileOutlined />}>
                Open File...
              </Button>
              {fileName && <Typography.Text style={{ color: 'white' }}>{fileName}</Typography.Text>}

              <Dropdown menu={{ items: themeMenuItems, selectedKeys: [themeName] }}>
                <Button icon={isDarkMode ? <MoonOutlined /> : <SunOutlined />}>{t('theme')}</Button>
              </Dropdown>

              <LanguageDropdown />
            </Space>
          </Layout.Header>
          <Layout.Content
            ref={contentRef}
            style={{ height: `calc(100% - ${HEADER_HEIGHT}px - ${AD_HEIGHT}px)` }}
          >
            {doc && contentHeight > 0 && (
              // key={doc.docId} forces a full remount on each newly opened document --
              // otherwise XmlTree's internal treeData state (seeded once from its
              // initial `root` prop) would keep showing the previous document's tree.
              <XmlTree key={doc.docId} docId={doc.docId} root={doc.root} height={contentHeight} />
            )}
          </Layout.Content>
          <Layout.Footer style={{ padding: 0, height: AD_HEIGHT }}>
            <AdBar />
          </Layout.Footer>
        </Layout>
      </ThemeNameContext>
    </ConfigProvider>
  );
}
