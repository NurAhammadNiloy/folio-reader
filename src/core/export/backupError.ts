export class BackupError extends Error {
  readonly code: 'too-large' | 'not-backup' | 'corrupt' | 'unsafe' | 'version' | 'invalid' | 'conflict' | 'capacity';
  constructor(code: BackupError['code'], message: string) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}
