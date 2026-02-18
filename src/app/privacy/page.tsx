import Link from "next/link";
import { Zap, ArrowLeft } from "lucide-react";

export const metadata = {
  title: "プライバシーポリシー・免責事項 | AI Buzz Media",
  description:
    "AI Buzz Mediaのプライバシーポリシーおよび免責事項です。個人情報の利用、アクセス解析、広告、AIコンテンツについての注意事項を掲載しています。",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-6">
          <Link
            href="/"
            className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
            ホームに戻る
          </Link>
          <h1 className="flex items-center gap-3 text-2xl font-bold text-slate-900">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500">
              <Zap className="h-5 w-5 text-white" />
            </span>
            プライバシーポリシー・免責事項
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="space-y-10">
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold text-slate-900">
              1. 個人情報の利用目的
            </h2>
            <p className="leading-relaxed text-slate-700">
              お問い合わせフォームで取得した情報は、返信のみに利用します。第三者に提供することはありません。
            </p>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold text-slate-900">
              2. アクセス解析ツールについて
            </h2>
            <p className="leading-relaxed text-slate-700">
              当サイトではGoogleアナリティクスを利用しています。Cookieを使用しデータ収集を行いますが、匿名で収集されており個人を特定するものではありません。詳しくはGoogleのプライバシーポリシーをご確認ください。
            </p>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold text-slate-900">
              3. 広告の配信について
            </h2>
            <p className="leading-relaxed text-slate-700">
              当サイトは、Amazonアソシエイト・楽天アフィリエイトなどの適格販売により収入を得ています。広告表示およびリンク先の商品・サービスについて、当サイトは一切の責任を負いかねます。
            </p>
          </section>

          <section className="rounded-xl border-2 border-amber-200 bg-amber-50/80 p-6 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold text-slate-900">
              【重要】免責事項（AIコンテンツについて）
            </h2>
            <p className="leading-relaxed text-slate-800">
              当サイトのコンテンツ（記事・コメント・画像）の一部または全部は、生成AI技術を用いて作成されています。架空のキャラクターによる演出を含んでおり、情報の正確性や商品の完全性を保証するものではありません。商品のご購入に際しては、リンク先の販売店ページをご確認ください。
            </p>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold text-slate-900">
              5. 著作権
            </h2>
            <p className="leading-relaxed text-slate-700">
              当サイトへのリンクは自由です。ただし、著作権は放棄しておりません。当サイトのコンテンツの無断転載・複製はお断りします。
            </p>
          </section>
        </div>

        <div className="mt-10 text-center">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-800"
          >
            <ArrowLeft className="h-4 w-4" />
            ホームに戻る
          </Link>
        </div>
      </main>
    </div>
  );
}
