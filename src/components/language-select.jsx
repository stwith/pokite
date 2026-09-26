import { CompactSelect } from "./ui/compact-select";
import { locale, setLocale } from "../lib/i18n";
export function LanguageSelect() {
  return (
    <CompactSelect
      label="Language / 语言"
      defaultOption={false}
      value={locale}
      onChange={setLocale}
      options={[
        { id: "zh-CN", label: "中文" },
        { id: "en", label: "English" },
      ]}
    />
  );
}
