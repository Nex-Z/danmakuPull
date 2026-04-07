import { startTransition, useMemo, useState } from "react";
import { Film, LoaderCircle, Play, Save, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { PlatformId, SearchResponse, SearchResultItem } from "@shared/types";

export function SearchPage() {
  const [platform, setPlatform] = useState<PlatformId>("bilibili");
  const [keyword, setKeyword] = useState("");
  const [pageIndexes, setPageIndexes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResponse | null>(null);

  const canSearch = keyword.trim().length > 0 && !loading;
  const rows = result?.items ?? [];

  const emptyHint = useMemo(() => {
    if (loading) {
      return "正在请求平台搜索接口…";
    }
    if (result && result.items.length === 0) {
      return "没有找到候选结果，可以检查关键词或凭证。";
    }
    return "先选择平台并搜索一个电影 / 视频名称。";
  }, [loading, result]);

  async function runSearch() {
    if (!canSearch) {
      return;
    }
    setLoading(true);
    try {
      const response = await window.app.search.run({
        platform,
        keyword
      });
      startTransition(() => {
        setResult(response);
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  async function saveOrPlay(item: SearchResultItem, shouldPlay: boolean) {
    try {
      const pageIndex =
        platform === "bilibili"
          ? Math.max(0, Number(pageIndexes[item.id] || "1") - 1)
          : 0;
      const resource = await window.app.resource.save({
        platform,
        item,
        pageIndex
      });
      if (shouldPlay) {
        await window.app.overlay.open({
          resourceId: resource.id,
          autoplay: true
        });
        toast.success(`已打开悬浮弹幕窗：${resource.title}`);
      } else {
        toast.success(`已保存资源：${resource.title}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="text-sm uppercase tracking-[0.28em] text-primary/70">
          Search
        </div>
        <h1 className="text-3xl font-semibold text-foreground">搜索并直接播放弹幕</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          选择平台，搜索影片名称，然后直接保存为资源或打开悬浮弹幕窗。Bilibili 支持分 P，
          腾讯视频按 VID 建立资源。
        </p>
      </div>

      <Card className="border-border/70 bg-card/90">
        <CardHeader>
          <CardTitle>快速搜索</CardTitle>
          <CardDescription>用平台原生搜索接口拿候选资源，随后进入缓存和悬浮播放链路。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ToggleGroup
            type="single"
            value={platform}
            onValueChange={(value) => {
              if (value === "bilibili" || value === "tencent") {
                setPlatform(value);
              }
            }}
          >
            <ToggleGroupItem value="bilibili">Bilibili</ToggleGroupItem>
            <ToggleGroupItem value="tencent">Tencent Video</ToggleGroupItem>
          </ToggleGroup>
          <div className="flex flex-col gap-3 md:flex-row">
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="例如：疯狂动物城 / 庆余年 / 速度与激情"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void runSearch();
                }
              }}
            />
            <Button className="md:min-w-36" disabled={!canSearch} onClick={() => void runSearch()}>
              {loading ? (
                <LoaderCircle className="animate-spin" data-icon="inline-start" />
              ) : (
                <Search data-icon="inline-start" />
              )}
              搜索
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/90">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>候选结果</CardTitle>
            <CardDescription>{emptyHint}</CardDescription>
          </div>
          {result ? (
            <Badge variant="secondary">
              {result.platform === "bilibili" ? "Bilibili" : "Tencent"} · {result.total} 条
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 px-6 py-16 text-center text-sm text-muted-foreground">
              {emptyHint}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>标题</TableHead>
                  <TableHead>信息</TableHead>
                  <TableHead className="w-40">分 P</TableHead>
                  <TableHead className="w-56 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <div className="font-medium text-foreground">{item.title}</div>
                        <div className="text-sm text-muted-foreground">{item.summary || "暂无简介"}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                        <span>{item.subtitle || "未提供副标题"}</span>
                        <span>{item.metaLine || "未提供额外信息"}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {platform === "bilibili" ? (
                        <Input
                          type="number"
                          min={1}
                          value={pageIndexes[item.id] ?? "1"}
                          onChange={(event) =>
                            setPageIndexes((current) => ({
                              ...current,
                              [item.id]: event.target.value
                            }))
                          }
                        />
                      ) : (
                        <Badge variant="outline">VID</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => void saveOrPlay(item, false)}
                        >
                          <Save data-icon="inline-start" />
                          保存
                        </Button>
                        <Button onClick={() => void saveOrPlay(item, true)}>
                          <Play data-icon="inline-start" />
                          播放弹幕
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
        <CardFooter className="justify-between text-sm text-muted-foreground">
          <span>点击“播放弹幕”后，主进程会先检查缓存，必要时抓首段再打开悬浮层。</span>
          <div className="inline-flex items-center gap-2">
            <Film className="size-4" />
            支持直接进入 overlay 播放
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
