import {
  MAX_DOCUMENT_BYTES,
  decryptDocument,
  documentKey,
  encryptDocument,
  inspectDocument,
} from './identity-document.js';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);

describe('inspectDocument', () => {
  it('accepts a JPEG declared as one, with or without a data URL prefix', () => {
    const plain = inspectDocument(jpeg.toString('base64'), 'image/jpeg');
    const prefixed = inspectDocument(
      `data:image/jpeg;base64,${jpeg.toString('base64')}`,
      'image/jpeg',
    );
    expect(plain).toMatchObject({ ok: true, contentType: 'image/jpeg' });
    expect(prefixed).toMatchObject({ ok: true, contentType: 'image/jpeg' });
  });

  it('refuses a file whose bytes are not the type it claims', () => {
    expect(inspectDocument(png.toString('base64'), 'image/jpeg')).toEqual({
      ok: false,
      problem: 'TYPE_MISMATCH',
    });
  });

  it('refuses anything that is not an image or PDF', () => {
    const script = Buffer.from('#!/bin/sh\nrm -rf /');
    expect(inspectDocument(script.toString('base64'), 'image/jpeg')).toEqual({
      ok: false,
      problem: 'UNSUPPORTED_TYPE',
    });
  });

  it('refuses an empty or oversized upload', () => {
    expect(inspectDocument('', 'image/jpeg')).toEqual({ ok: false, problem: 'EMPTY' });
    const big = Buffer.concat([jpeg, Buffer.alloc(MAX_DOCUMENT_BYTES)]);
    expect(inspectDocument(big.toString('base64'), 'image/jpeg')).toEqual({
      ok: false,
      problem: 'TOO_LARGE',
    });
  });
});

describe('document encryption', () => {
  const key = documentKey('a'.repeat(32));

  it('round-trips and never stores the plain bytes', () => {
    const sealed = encryptDocument(jpeg, key);
    expect(sealed.includes(jpeg)).toBe(false);
    expect(decryptDocument(sealed, key)).toEqual(jpeg);
  });

  it('uses a fresh IV each time', () => {
    expect(encryptDocument(jpeg, key)).not.toEqual(encryptDocument(jpeg, key));
  });

  it('fails on tampering or the wrong key', () => {
    const sealed = encryptDocument(jpeg, key);
    const tampered = Buffer.from(sealed);
    const last = tampered.length - 1;
    tampered.writeUInt8((tampered.readUInt8(last) ^ 0xff) & 0xff, last);
    expect(() => decryptDocument(tampered, key)).toThrow();
    expect(() => decryptDocument(sealed, documentKey('b'.repeat(32)))).toThrow();
  });
});
