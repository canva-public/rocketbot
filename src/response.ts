export type JSONResponse =
  | { error: string }
  | ({ success: boolean; triggered: boolean; commented?: boolean } & (
      | { commentUrl?: string }
      | { updatedCommentUrl: string }
      | { message: string }
    ));
