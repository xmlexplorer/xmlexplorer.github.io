import { Typography } from "antd";
import { useTranslation } from "react-i18next";
import LanguageSelect from "./LanguageSelect";
import ThemeSelect from "./ThemeSelect";

const { Title, Paragraph } = Typography;

export default function HelpPanel() {
  const { t } = useTranslation();

  return (<div style={{ padding: '0px 16px 16px', maxWidth: 900, margin: '0 auto' }}>
    <Typography>
      <Paragraph>
        <LanguageSelect />
      </Paragraph>

      <Paragraph>
        <ThemeSelect />
      </Paragraph>

      <Title level={3}>XML Explorer</Title>
      <Paragraph>{t('app_description')}</Paragraph>

      <Title level={4}>{t('getting_started')}</Title>
      <Paragraph>{t('get_started_intro')}</Paragraph>

      <Paragraph>
        <ul>
          <li>
            {t('open_file_instruction')}
          </li>
          <li>
            {t('drag_drop_description')}
          </li>
        </ul>
      </Paragraph>

    </Typography>
  </div>);
}