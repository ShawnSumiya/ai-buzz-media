/** 会話の1発話（新形式: Every comment is a new persona） */
export interface TranscriptTurn {
  id: string;
  speaker_name: string;
  speaker_attribute: string;
  content: string;
  timestamp: string;
}

/** 旧形式との互換用: speaker/content のみのレガシー */
export interface LegacyTranscriptTurn {
  speaker?: string;
  content: string;
  timestamp?: string;
}

/** キャラクター設定（create-hype 初期生成用・add-comment-stream では使用しない） */
export interface CastProfile {
  name: string;
  role: string;
  short_description: string;
}

/** DB: promo_threads の型 */
export interface PromoThread {
  id: string;
  product_name: string;
  source_url: string | null;
  key_features: string;
  og_image_url?: string | null;
  cast_profiles: unknown[];
  transcript: TranscriptTurn[];
  created_at: string;
}

/** create-hype API のリクエスト */
export interface CreateHypeRequest {
  url?: string;
  text_content?: string;
}

/** add-comment-stream API のレスポンス */
export interface AddCommentStreamResponse {
  newComments: TranscriptTurn[];
  transcript: TranscriptTurn[];
}
