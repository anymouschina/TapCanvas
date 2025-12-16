export type FunctionResult<TData = any> =
  | { success: true; data: TData }
  | { success: false; error: string }

