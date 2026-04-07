import { useEffect, useState } from "react";
import { LoaderCircle, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import type { AppSettings, PlatformCredentials, PlatformId } from "@shared/types";

type PlatformForms = Record<PlatformId, PlatformCredentials>;

const emptyCredentials: PlatformCredentials = {
  cookie: "",
  userAgent: "",
  referer: ""
};

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [credentials, setCredentials] = useState<PlatformForms>({
    bilibili: emptyCredentials,
    tencent: emptyCredentials
  });
  const [saving, setSaving] = useState(false);
  const [testingPlatform, setTestingPlatform] = useState<PlatformId | null>(null);

  useEffect(() => {
    void (async () => {
      const [settingsValue, bili, tx] = await Promise.all([
        window.app.config.get(),
        window.app.credentials.get("bilibili"),
        window.app.credentials.get("tencent")
      ]);
      setSettings(settingsValue);
      setCredentials({
        bilibili: bili,
        tencent: tx
      });
    })();
  }, []);

  if (!settings) {
    return null;
  }

  async function saveSettings() {
    if (!settings) {
      return;
    }
    setSaving(true);
    try {
      const [nextSettings, bili, tx] = await Promise.all([
        window.app.config.update(settings),
        window.app.credentials.set("bilibili", credentials.bilibili),
        window.app.credentials.set("tencent", credentials.tencent)
      ]);
      setSettings(nextSettings);
      setCredentials({
        bilibili: bili,
        tencent: tx
      });
      toast.success("设置已保存。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function testPlatform(platform: PlatformId) {
    setTestingPlatform(platform);
    try {
      const result = await window.app.credentials.test(platform);
      if (result.ok) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } finally {
      setTestingPlatform(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-sm uppercase tracking-[0.28em] text-primary/70">
            Settings
          </div>
          <h1 className="mt-2 text-3xl font-semibold text-foreground">
            平台与播放设置
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
            管理 Cookie、UA、缓存目录，以及悬浮弹幕窗的默认行为。正式运行时不依赖
            <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">.env.local</code>
            ，全部从这里读。
          </p>
        </div>
        <Button disabled={saving} onClick={() => void saveSettings()}>
          {saving ? (
            <LoaderCircle className="animate-spin" data-icon="inline-start" />
          ) : (
            <Save data-icon="inline-start" />
          )}
          保存全部设置
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_420px]">
        <Card className="border-border/70 bg-card/90">
          <CardHeader>
            <CardTitle>客户端默认行为</CardTitle>
            <CardDescription>
              这里的项会影响缓存路径、悬浮窗默认位置和各平台预抓策略。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field orientation="horizontal">
                <div className="flex flex-col gap-1">
                  <FieldTitle>缓存目录</FieldTitle>
                  <FieldDescription>抓到的原始响应和解析结果默认都会放在这里。</FieldDescription>
                </div>
                <Input
                  value={settings.cacheRoot}
                  onChange={(event) =>
                    setSettings((current) =>
                      current
                        ? { ...current, cacheRoot: event.target.value }
                        : current
                    )
                  }
                />
              </Field>

              <Field orientation="horizontal">
                <div className="flex flex-col gap-1">
                  <FieldTitle>默认置顶</FieldTitle>
                  <FieldDescription>打开悬浮弹幕窗时是否默认保持顶层。</FieldDescription>
                </div>
                <div className="flex items-center justify-end">
                  <Switch
                    checked={settings.overlay.alwaysOnTop}
                    onCheckedChange={(checked) =>
                      setSettings((current) =>
                        current
                          ? {
                              ...current,
                              overlay: {
                                ...current.overlay,
                                alwaysOnTop: checked
                              }
                            }
                          : current
                      )
                    }
                  />
                </div>
              </Field>

              <Field orientation="horizontal">
                <div className="flex flex-col gap-1">
                  <FieldTitle>B 站预抓分段</FieldTitle>
                  <FieldDescription>点击播放时，除了首段外继续后台拉多少个 segment。</FieldDescription>
                </div>
                <Input
                  type="number"
                  min={1}
                  value={settings.bilibili.prefetchSegments}
                  onChange={(event) =>
                    setSettings((current) =>
                      current
                        ? {
                            ...current,
                            bilibili: {
                              ...current.bilibili,
                              prefetchSegments: Number(event.target.value || 1)
                            }
                          }
                        : current
                    )
                  }
                />
              </Field>

              <Field orientation="horizontal">
                <div className="flex flex-col gap-1">
                  <FieldTitle>腾讯预抓窗口</FieldTitle>
                  <FieldDescription>点击播放时，腾讯视频从当前起点继续预抓多少个时间窗口。</FieldDescription>
                </div>
                <Input
                  type="number"
                  min={1}
                  value={settings.tencent.prefetchWindows}
                  onChange={(event) =>
                    setSettings((current) =>
                      current
                        ? {
                            ...current,
                            tencent: {
                              ...current.tencent,
                              prefetchWindows: Number(event.target.value || 1)
                            }
                          }
                        : current
                    )
                  }
                />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card className="border-primary/20 bg-primary/[0.06]">
          <CardHeader>
            <CardTitle>运行提示</CardTitle>
            <CardDescription>先把平台凭证存好，再去搜索和播放。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-6 text-muted-foreground">
            <p>1. Bilibili 通常需要有效 Cookie 才能稳定拉弹幕分段。</p>
            <p>2. 腾讯视频如果搜索或弹幕接口有风控，也可以在这里补 Cookie 和 UA。</p>
            <p>3. 悬浮弹幕窗会记住上次的大小、位置、置顶和内容缩放比例。</p>
          </CardContent>
          <CardFooter>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-background px-3 py-2 text-sm text-foreground">
              <ShieldCheck className="size-4 text-primary" />
              凭证会通过 Electron 安全存储加密后落盘
            </div>
          </CardFooter>
        </Card>
      </div>

      <Tabs defaultValue="bilibili" className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="bilibili">Bilibili</TabsTrigger>
          <TabsTrigger value="tencent">Tencent Video</TabsTrigger>
        </TabsList>
        {(["bilibili", "tencent"] as PlatformId[]).map((platform) => (
          <TabsContent value={platform} key={platform}>
            <Card className="border-border/70 bg-card/90">
              <CardHeader>
                <CardTitle>
                  {platform === "bilibili" ? "Bilibili" : "Tencent Video"} 凭证
                </CardTitle>
                <CardDescription>
                  Cookie 允许多行粘贴；User-Agent 和 Referer 会在搜索、详情和抓取时复用。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor={`${platform}-cookie`}>Cookie</FieldLabel>
                    <Textarea
                      id={`${platform}-cookie`}
                      rows={5}
                      value={credentials[platform].cookie}
                      onChange={(event) =>
                        setCredentials((current) => ({
                          ...current,
                          [platform]: {
                            ...current[platform],
                            cookie: event.target.value
                          }
                        }))
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${platform}-ua`}>User-Agent</FieldLabel>
                    <Input
                      id={`${platform}-ua`}
                      value={credentials[platform].userAgent}
                      onChange={(event) =>
                        setCredentials((current) => ({
                          ...current,
                          [platform]: {
                            ...current[platform],
                            userAgent: event.target.value
                          }
                        }))
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${platform}-referer`}>Referer</FieldLabel>
                    <Input
                      id={`${platform}-referer`}
                      value={credentials[platform].referer}
                      onChange={(event) =>
                        setCredentials((current) => ({
                          ...current,
                          [platform]: {
                            ...current[platform],
                            referer: event.target.value
                          }
                        }))
                      }
                    />
                  </Field>
                </FieldGroup>
              </CardContent>
              <CardFooter className="justify-end gap-3">
                <Button
                  variant="secondary"
                  disabled={testingPlatform === platform}
                  onClick={() => void testPlatform(platform)}
                >
                  {testingPlatform === platform ? (
                    <LoaderCircle className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <ShieldCheck data-icon="inline-start" />
                  )}
                  测试连接
                </Button>
              </CardFooter>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
