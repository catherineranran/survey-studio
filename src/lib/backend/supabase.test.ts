import { describe, expect, it } from 'vitest';
import { storageError } from './supabase';

const body = (statusCode: string, error: string, message: string) => JSON.stringify({ statusCode, error, message });

describe('Supabase Storage errors, for people uploading videos', () => {
  it('sends people to schema.sql when the bucket or its rules are missing', () => {
    for (const e of [
      storageError(400, body('404', 'Bucket not found', 'Bucket not found')),
      storageError(403, body('403', 'Unauthorized', 'new row violates row-level security policy')),
      storageError(415, body('415', 'invalid_mime_type', 'mime type application/octet-stream is not supported')),
    ]) {
      expect(e.code).toBe('setup');
      expect(e.message).toMatch(/run supabase\/schema\.sql again/);
    }
  });

  it('tells a full project, a refused size and an expired sign-in apart', () => {
    expect(storageError(400, body('413', 'Payload too large', 'The object exceeded the maximum allowed size'))).toMatchObject({ code: 'storage', message: expect.stringMatching(/file size limit/) });
    expect(storageError(413, 'Request Entity Too Large').code).toBe('storage');
    expect(storageError(400, body('402', 'exceed_storage_size_quota', 'Storage quota exceeded'))).toMatchObject({ code: 'storage', message: expect.stringMatching(/1 GB/) });
    expect(storageError(400, body('400', 'Unauthorized', 'jwt expired'))).toMatchObject({ code: 'auth' });
  });

  it('marks failures where trying again may help', () => {
    expect(storageError(0, '').code).toBe('network');
    expect(storageError(503, 'Service Unavailable').code).toBe('network');
    expect(storageError(429, body('429', 'Too many requests', 'slow down')).code).toBe('network');
    expect(storageError(400, body('400', 'InvalidKey', 'Invalid key: a/b')).code).toBe('unknown');
  });
});
