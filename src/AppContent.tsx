import { FileOutlined, FunctionOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons';
import { open } from '@tauri-apps/plugin-dialog';
import { Button, Dropdown, Layout, Space, Typography, message, theme } from 'antd';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdBar } from './components/AdBar';
import { DropOverlay } from './components/DropOverlay';
import HelpPanel from './components/HelpPanel';
import LanguageDropdown from './components/LanguageDropdown';
import { XPathPanel } from './components/XPathPanel';
import { XmlTree, type XmlTreeHandle } from './components/XmlTree';
import { useFileDrop } from './hooks/useFileDrop';
import useThemeMenuItems from './hooks/useThemeMenuItems';
import { ThemeNameContext } from './hooks/useThemeName';
import { paintFrame } from './lib/paintFrame';
import { baseName } from './lib/path';
import { closeDocument, openDocument, type OpenedDocument } from './lib/tauri';

const HEADER_HEIGHT = 'auto';
const AD_HEIGHT = 90;

export function AppContent() {
  const { t } = useTranslation();
  const [doc, setDoc] = useState<OpenedDocument | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [xpathOpen, setXpathOpen] = useState(false);
  const [selectedNode, setSelectedNode] = useState<{ nodeId: number; label: string } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<XmlTreeHandle>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);

  const { token: { colorBgContainer } } = theme.useToken();

  const themeNameContext = use(ThemeNameContext);
  const isDarkMode = themeNameContext?.isDarkMode ?? false;
  const themeName = themeNameContext?.themeName ?? 'auto';
  const themeMenuItems = useThemeMenuItems();

  const { isDragging, invalidDrop } = useFileDrop((path) => onLoadFile(path));

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

  const onLoadFile = useCallback((path: string) => {
    void (async () => {
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
        setSelectedNode(null);
      } catch (err) {
        void message.error(String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [doc]);

  const onOpenFile = useCallback(() => {
    void (async () => {
      // No extension filter: lots of formats are really XML (.svg, .rss, .xsl,
      // .csproj, .config, ...), so we let any file be picked and let the parser
      // decide. (On macOS, any filter also disables an "all files" option anyway.)
      const path = await open({ multiple: false });
      if (!path || typeof path !== 'string') {
        return;
      }
      onLoadFile(path);
    })();
  }, [onLoadFile]);

  console.log({ doc });

  return (
    <div style={{ height: '100%', position: 'relative', backgroundColor: colorBgContainer }}>
      <DropOverlay isDragging={isDragging} invalidDrop={invalidDrop} />
      <Layout style={{ height: '100%' }}>

        <Layout.Header style={{ backgroundColor: colorBgContainer, height: 'auto', lineHeight: 'normal', padding: 4, display: 'flex', alignItems: 'center' }}>

          <Space wrap align="center">
            {/* <span style={{ marginRight: 8, fontFamily: 'inherit' }}>XML Explorer</span> */}

            <Button onClick={onOpenFile} loading={loading} icon={<FileOutlined />}>
              Open File...
            </Button>
            {fileName && <Typography.Text style={{ color: 'white' }}>{fileName}</Typography.Text>}

            {doc && (
              <>
                <Button
                  onClick={() => setXpathOpen(true)}
                  disabled={!doc}
                  icon={<FunctionOutlined />}
                >
                  XPath...
                </Button>

                <Dropdown menu={{ items: themeMenuItems, selectedKeys: [themeName] }}>
                  <Button icon={isDarkMode ? <MoonOutlined /> : <SunOutlined />}>{t('theme')}</Button>
                </Dropdown>

                <LanguageDropdown />
              </>)}
          </Space>
        </Layout.Header>
        <Layout.Content
          ref={contentRef}
          style={{ height: `calc(100% - ${HEADER_HEIGHT}px - ${AD_HEIGHT}px)`, background: colorBgContainer, padding: 4 }}
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
        <Layout.Footer style={{ padding: 0, height: AD_HEIGHT }}>
          <AdBar />
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
    </div>
  );
}
