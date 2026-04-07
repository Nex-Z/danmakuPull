import { useEffect, useState } from "react";
import { FolderSync, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMs, formatNumber } from "@/lib/format";
import type { ResourceRef } from "@shared/types";

export function ResourcesPage() {
  const [resources, setResources] = useState<ResourceRef[]>([]);

  async function refresh() {
    setResources(await window.app.resource.list());
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function play(resource: ResourceRef) {
    await window.app.overlay.open({
      resourceId: resource.id,
      autoplay: true
    });
    toast.success(`已打开 ${resource.title} 的悬浮弹幕窗。`);
  }

  async function prefetch(resource: ResourceRef) {
    const job = await window.app.fetch.start({
      resourceId: resource.id
    });
    toast.success(`已启动抓取任务 #${job.id}`);
  }

  async function remove(resource: ResourceRef) {
    await window.app.resource.delete(resource.id);
    toast.success(`已删除资源：${resource.title}`);
    await refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="text-sm uppercase tracking-[0.28em] text-primary/70">
          Resources
        </div>
        <h1 className="mt-2 text-3xl font-semibold text-foreground">资源与缓存</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
          这里展示已经保存到本地数据库的资源、缓存分段和弹幕数量。可以继续预抓，也可以直接打开悬浮弹幕窗。
        </p>
      </div>

      <Card className="border-border/70 bg-card/90">
        <CardHeader>
          <CardTitle>已保存资源</CardTitle>
          <CardDescription>资源删除后，对应的缓存记录和 overlay 会话也会一并清理。</CardDescription>
        </CardHeader>
        <CardContent>
          {resources.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 px-6 py-16 text-center text-sm text-muted-foreground">
              还没有保存任何资源。先去“搜索管理”里保存或直接播放一个候选结果。
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>资源</TableHead>
                  <TableHead>缓存概览</TableHead>
                  <TableHead className="w-64 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resources.map((resource) => (
                  <TableRow key={resource.id}>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <div className="font-medium text-foreground">{resource.title}</div>
                        <div className="text-sm text-muted-foreground">{resource.subtitle}</div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            {resource.platform === "bilibili" ? "Bilibili" : "Tencent"}
                          </Badge>
                          <Badge variant="secondary">ID {resource.id}</Badge>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                        <span>缓存块：{formatNumber(resource.cacheSummary.chunks)}</span>
                        <span>弹幕数：{formatNumber(resource.cacheSummary.danmakuItems)}</span>
                        <span>最大时间：{formatMs(resource.cacheSummary.maxTimeMs)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" onClick={() => void prefetch(resource)}>
                          <FolderSync data-icon="inline-start" />
                          继续预抓
                        </Button>
                        <Button onClick={() => void play(resource)}>
                          <Play data-icon="inline-start" />
                          播放
                        </Button>
                        <Button variant="outline" onClick={() => void remove(resource)}>
                          <Trash2 data-icon="inline-start" />
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
