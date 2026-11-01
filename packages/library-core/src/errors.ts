export type LibraryErrorCode = 'not_found' | 'invalid_name' | 'duplicate_name' | 'cycle' | 'too_new';

export class LibraryError extends Error {
  code: LibraryErrorCode;

  constructor(code: LibraryErrorCode, message: string = code) {
    super(message);
    this.name = 'LibraryError';
    this.code = code;
  }
}
