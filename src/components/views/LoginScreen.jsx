import { LanguageSelect } from "../language-select";
import { t } from "../../lib/i18n.js";
import { PairingScanner } from "../pairing-scanner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { HomeScreenGuide } from "../home-screen-guide";
export function LoginScreen({
  setToken,
  login,
  token,
  error,
  storageUnavailable,
}) {
  return (
    <main className="login">
      <LanguageSelect />
      <div className="login-brand">
        <img src="/brand/pokite-mark.svg" width="48" height="48" alt="" />
        <h1>
          Pokite <span>{t("口袋风筝")}</span>
        </h1>
      </div>
      <div className="login-heading">
        <h2>{t("连接你的电脑")}</h2>
        <p>{t("继续电脑上正在运行的会话。")}</p>
      </div>
      <PairingScanner
        onConnect={async (value) => {
          setToken(value);
          await login(value);
        }}
      />
      <div className="login-divider">
        <span>{t("或使用访问码")}</span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          login();
        }}
      >
        <label htmlFor="token">{t("访问码")}</label>
        <Input
          id="token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="current-password"
          placeholder={t("粘贴访问码")}
          autoCapitalize="none"
          spellCheck={false}
        />
        <Button type="submit">{t("连接")}</Button>
      </form>
      <details className="login-help">
        <summary>{t("在哪里获取连接信息？")}</summary>
        <p>
          {t(
            "在电脑上的 Pokite 打开侧栏底部的二维码按钮，查看二维码和访问码。手机与电脑需在同一局域网或 Tailscale 网络。",
          )}
        </p>
      </details>
      <HomeScreenGuide />
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {storageUnavailable && (
        <div className="error-banner" role="status">
          <span>
            {t(
              "部分本地数据尚未保存。当前输入保留在本页，刷新或关闭页面可能丢失。",
            )}
          </span>
        </div>
      )}
    </main>
  );
}
