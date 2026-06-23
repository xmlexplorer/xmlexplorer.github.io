import { FileOutlined } from '@ant-design/icons';
import { open } from '@tauri-apps/plugin-dialog';
import { Button, Layout, Typography, message } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { XmlTree } from './components/XmlTree';
import { paintFrame } from './lib/paintFrame';
import { closeDocument, openDocument, type OpenedDocument } from './lib/tauri';

const HEADER_HEIGHT = 56;

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function App() {
  const [doc, setDoc] = useState<OpenedDocument | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

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
    <Layout style={{ height: '100%' }}>
      <Layout.Header
        style={{ display: 'flex', alignItems: 'center', gap: 12, height: HEADER_HEIGHT }}
      >
        <Button size="small" onClick={onOpenFile} loading={loading} icon={<FileOutlined />}>
          Open File...
        </Button>
        {fileName && <Typography.Text style={{ color: 'white' }}>{fileName}</Typography.Text>}
      </Layout.Header>
      <Layout.Content ref={contentRef} style={{ height: `calc(100% - ${HEADER_HEIGHT}px)` }}>
        {doc && contentHeight > 0 && (
          // key={doc.docId} forces a full remount on each newly opened document --
          // otherwise XmlTree's internal treeData state (seeded once from its
          // initial `root` prop) would keep showing the previous document's tree.
          <XmlTree key={doc.docId} docId={doc.docId} root={doc.root} height={contentHeight} />
        )}
      </Layout.Content>
    </Layout>
  );
}
