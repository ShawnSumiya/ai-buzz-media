import type { MetadataRoute } from "next";
import { supabase } from "@/lib/supabase";

const baseUrl = "https://ai-buzz-media.vercel.app";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // 静的ページ
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1.0,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];

  // 動的ページ（スレッド一覧）: promo_threads から公開済みの全スレッドを取得
  const { data: threads, error } = await supabase
    .from("promo_threads")
    .select("id, created_at")
    .order("created_at", { ascending: false });

  const dynamicPages: MetadataRoute.Sitemap = [];
  if (!error && threads && Array.isArray(threads)) {
    for (const row of threads) {
      const id = (row as { id?: string }).id;
      const createdAt = (row as { created_at?: string }).created_at;
      if (id) {
        dynamicPages.push({
          url: `${baseUrl}/thread/${id}`,
          lastModified: createdAt ? new Date(createdAt) : new Date(),
          changeFrequency: "weekly" as const,
          priority: 0.8,
        });
      }
    }
  }

  return [...staticPages, ...dynamicPages];
}
