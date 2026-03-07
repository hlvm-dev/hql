export interface RuntimeOllamaSigninResponse {
  success: boolean;
  output: string[];
  signinUrl: string | null;
  browserOpened: boolean;
}
