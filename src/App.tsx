import enUS from 'antd/locale/en_US';
import esES from 'antd/locale/es_ES';
import ptBR from 'antd/locale/pt_BR';
import ruRU from 'antd/locale/ru_RU';
import zhCN from 'antd/locale/zh_CN';
import { ConfigProvider, theme } from 'antd';
import { useTranslation } from 'react-i18next';
import { AppContent } from './AppContent';
import { ThemeNameContext, useThemeName, type ThemeNames } from './hooks/useThemeName';

const ANTD_LOCALES: Record<string, typeof enUS> = {
  en: enUS,
  es: esES,
  ru: ruRU,
  'zh-CN': zhCN,
  'pt-BR': ptBR,
};

export default function App() {
  const { defaultAlgorithm, darkAlgorithm } = theme;
  const { isDarkMode, themeName, setTheme } = useThemeName();
  const { i18n } = useTranslation();

  const updateThemeName = (value: ThemeNames) => {
    setTheme(value);
  };

  const antdLocale = ANTD_LOCALES[i18n.resolvedLanguage ?? i18n.language] ?? enUS;

  return (
    <ConfigProvider
      locale={antdLocale}
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
        <AppContent />
      </ThemeNameContext>
    </ConfigProvider>
  );
}
