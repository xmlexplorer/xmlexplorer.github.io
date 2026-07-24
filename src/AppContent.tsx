import { FileOutlined, FunctionOutlined, GithubOutlined, HeartOutlined, MoonOutlined, QuestionCircleOutlined, SafetyCertificateOutlined, SunOutlined } from '@ant-design/icons';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { App as AntApp, App, Button, Dropdown, Layout, Space, Typography, theme } from 'antd';
import { use, useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { DropOverlay } from './components/DropOverlay';
import HelpPanel from './components/HelpPanel';
import LanguageDropdown from './components/LanguageDropdown';
import { ValidatePanel } from './components/ValidatePanel';
import { XPathPanel } from './components/XPathPanel';
import { XmlTree, type XmlTreeHandle } from './components/XmlTree';
import { useFileDrop } from './hooks/useFileDrop';
import useThemeMenuItems from './hooks/useThemeMenuItems';
import { ThemeNameContext } from './hooks/useThemeName';
import { useUpdateCheck } from './hooks/useUpdateCheck';
import { closeDocument, openDocument, type OpenedDocument } from './lib/engine';
import { paintFrame } from './lib/paintFrame';
import { baseName } from './lib/path';
import { isDesktop } from './lib/platform';

const HEADER_HEIGHT = 'auto';
const FOOTER_HEIGHT = 40;

const DONATE_URL = 'https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=7827155';

const GITHUB_URL = 'https://github.com/xmlexplorer/xmlexplorer.github.io';

// The download/about page a native user is pointed at when a newer app is out.
const ABOUT_URL = 'https://xmlexplorer.github.io/about.html';

// Watches for a newer deployed/released version and surfaces it as a bottom-right
// notification: web users get a Reload button; native users get a link to the
// about page to download the update. Must render inside the <AntApp> wrapper so
// App.useApp() resolves the themed notification instance.
function UpdateNotifier() {
  const { notification } = AntApp.useApp();
  const { t } = useTranslation();
  const updateType = useUpdateCheck();
  const shownRef = useRef(false);

  useEffect(() => {
    if (!updateType || shownRef.current) {
      return;
    }
    shownRef.current = true;

    if (updateType === 'web') {
      notification.info({
        key: 'update',
        title: t('update.available'),
        description: t('update.web_description'),
        placement: 'bottomRight',
        duration: 0,
        actions: (
          <Button type="primary" size="small" onClick={() => window.location.reload()}>
            {t('update.reload')}
          </Button>
        ),
      });
    } else {
      notification.info({
        key: 'update',
        title: t('update.available'),
        description: (
          <>
            {t('update.native_description')}{' '}
            <a href={ABOUT_URL} onClick={(e) => { e.preventDefault(); void openUrl(ABOUT_URL); }}>
              {t('update.about_link')}
            </a>
          </>
        ),
        placement: 'bottomRight',
        duration: 0,
      });
    }
  }, [updateType, notification, t]);

  return null;
}

export function AppContent() {
  const { message } = App.useApp();
  const { t } = useTranslation();
  const [doc, setDoc] = useState<OpenedDocument | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [xpathOpen, setXpathOpen] = useState(false);
  const [validateOpen, setValidateOpen] = useState(false);
  const [selectedNode, setSelectedNode] = useState<{ nodeId: number; label: string } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<XmlTreeHandle>(null);
  // Web-only: a hidden <input type="file"> stands in for the native OS file
  // dialog, since the browser has no filesystem-path picker.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);

  const { token: { colorBgContainer } } = theme.useToken();

  const themeNameContext = use(ThemeNameContext);
  const isDarkMode = themeNameContext?.isDarkMode ?? false;
  const themeName = themeNameContext?.themeName ?? 'auto';
  const themeMenuItems = useThemeMenuItems();

  const { isDragging, invalidDrop } = useFileDrop((source) => onLoadFile(source));

  useEffect(() => {
    if (!contentRef.current) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      setContentHeight(entries[0].contentRect.height);
      setContentWidth(entries[0].contentRect.width);
    });
    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, []);

  // Accepts a native filesystem path (desktop) or a browser File (web); the
  // engine facade dispatches to the right backend based on the platform.
  const onLoadFile = useCallback((source: string | File) => {
    void (async () => {
      setLoading(true);
      await paintFrame();
      try {
        const opened = await openDocument(source);
        // Free the previous document's parsed tree on the backend -- otherwise
        // each opened file leaks for the lifetime of the app.
        if (doc) {
          void closeDocument(doc.docId);
        }
        setDoc(opened);
        setFileName(typeof source === 'string' ? baseName(source) : source.name);
        setSelectedNode(null);
      } catch (err) {
        void message.error(String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [doc]);

  const openExternal = useCallback((url: string) => {
    if (isDesktop()) {
      void openUrl(url);
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }, []);

  const onDonate = useCallback(() => openExternal(DONATE_URL), [openExternal]);

  const onGithub = useCallback(() => openExternal(GITHUB_URL), [openExternal]);

  const onOpenFile = useCallback(() => {
    // No extension filter: lots of formats are really XML (.svg, .rss, .xsl,
    // .csproj, .config, ...), so we let any file be picked and let the parser
    // decide. (On macOS, any filter also disables an "all files" option anyway.)
    if (!isDesktop()) {
      // The browser has no path picker -- trigger the hidden <input type="file">.
      fileInputRef.current?.click();
      return;
    }
    void (async () => {
      const path = await open({ multiple: false });
      if (!path || typeof path !== 'string') {
        return;
      }
      onLoadFile(path);
    })();
  }, [onLoadFile]);

  const onFileInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so picking the same file again still fires a change event.
    event.target.value = '';
    if (file) {
      onLoadFile(file);
    }
  }, [onLoadFile]);

  return (
    <AntApp style={{ height: '100%', position: 'relative', backgroundColor: colorBgContainer }}>
      <UpdateNotifier />
      {/* Web-only hidden picker, opened by onOpenFile when not running natively. */}
      <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={onFileInputChange} />
      <DropOverlay isDragging={isDragging} invalidDrop={invalidDrop} />
      <Layout style={{ height: '100%' }}>

        <Layout.Header style={{ backgroundColor: colorBgContainer, height: 'auto', lineHeight: 'normal', padding: 4, display: 'flex', alignItems: 'center' }}>

          <Space wrap align="center">
            {/* <span style={{ marginRight: 8, fontFamily: 'inherit' }}>XML Explorer</span> */}

            <Button onClick={onOpenFile} loading={loading} icon={<FileOutlined />}>
              {t('actions.open_file')}
            </Button>
            {fileName && <Typography.Text style={{ color: 'white' }}>{fileName}</Typography.Text>}

            {doc && (
              <>
                <Button
                  onClick={() => {
                    setValidateOpen(false);
                    setXpathOpen(true);
                  }}
                  disabled={!doc}
                  icon={<FunctionOutlined />}
                >
                  {t('actions.xpath')}
                </Button>

                <Button
                  onClick={() => {
                    setXpathOpen(false);
                    setValidateOpen(true);
                  }}
                  disabled={!doc}
                  icon={<SafetyCertificateOutlined />}
                >
                  {t('actions.validate')}
                </Button>

                <Dropdown menu={{ items: themeMenuItems, selectedKeys: [themeName] }}>
                  <Button icon={isDarkMode ? <MoonOutlined /> : <SunOutlined />}>{t('theme')}</Button>
                </Dropdown>

                <LanguageDropdown />
              </>)}

            <Dropdown menu={{
              items: [
                {
                  key: 'version',
                  label: `XML Explorer v${__APP_VERSION__} (${__GIT_HASH__})`,
                  disabled: true,
                },
                {
                  key: 'about',
                  label: (
                    <a href="about.html" target="_blank" rel="noopener noreferrer">
                      {t('about')}
                    </a>
                  ),
                },
              ]
            }}>
              <Button
                type="link"
                icon={<QuestionCircleOutlined />}
                style={{ marginLeft: 'auto' }}
              />
            </Dropdown>

          </Space>
        </Layout.Header>
        <Layout.Content
          ref={contentRef}
          style={{ height: `calc(100% - ${HEADER_HEIGHT}px - ${FOOTER_HEIGHT}px)`, background: colorBgContainer, padding: 4 }}
        >
          {doc && contentHeight > 0 && (
            // key={doc.docId} forces a full remount on each newly opened document --
            // otherwise XmlTree's internal treeData state (seeded once from its
            // initial `root` prop) would keep showing the previous document's tree.
            <XmlTree
              ref={treeRef}
              key={doc.docId}
              docId={doc.docId}
              root={doc.root}
              height={contentHeight}
              width={contentWidth}
              onSelectNode={setSelectedNode}
            />
          )}
          {!doc && (
            <HelpPanel />
          )}
        </Layout.Content>
        <Layout.Footer
          style={{
            height: FOOTER_HEIGHT,
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
          }}
        >
          <Button type="link" size="small" icon={<HeartOutlined />} onClick={onDonate}>
            {t('donate')}
          </Button>
          <Button type="link" size="small" icon={<GithubOutlined />} onClick={onGithub}>
            {t('actions.code')}
          </Button>
        </Layout.Footer>
      </Layout>
      {doc && (
        // key={doc.docId} resets the panel's query/results when a new file is opened.
        <XPathPanel
          key={doc.docId}
          docId={doc.docId}
          contextNodeId={selectedNode?.nodeId ?? doc.root.nodeId}
          contextLabel={selectedNode?.label || doc.root.label}
          onLocate={(nodeId) => treeRef.current?.reveal(nodeId)}
          open={xpathOpen}
          onClose={() => setXpathOpen(false)}
        />
      )}
      {doc && (
        // key={doc.docId} resets the panel's results when a new file is opened.
        <ValidatePanel
          key={doc.docId}
          docId={doc.docId}
          onLocate={(nodeId) => treeRef.current?.reveal(nodeId)}
          open={validateOpen}
          onClose={() => setValidateOpen(false)}
        />
      )}
    </AntApp>
  );
}
